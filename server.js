require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const deepseek = require('./deepseek');
const github = require('./github');
const railway = require('./railway');
const { parseAndExecuteJSON } = require('./json-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Store conversation history (in-memory, last 10 messages)
let conversationHistory = [];
const MAX_HISTORY = 10;

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    // Add user message to history
    conversationHistory.push({ role: 'user', content: message });
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

    // Get response from DeepSeek
    const response = await deepseek.chat(conversationHistory);
    
    // Add assistant response to history
    conversationHistory.push({ role: 'assistant', content: response });
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

    // Check if response contains JSON operations
    const jsonOperations = extractJSONOperations(response);
    if (jsonOperations.length > 0) {
      const results = await parseAndExecuteJSON(jsonOperations);
      return res.json({ 
        response, 
        operations: results,
        message: 'Operations executed'
      });
    }

    res.json({ response });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get repo files
app.get('/api/repo/files', async (req, res) => {
  try {
    const files = await github.listFiles();
    res.json({ files });
  } catch (error) {
    console.error('Repo files error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get file content
app.get('/api/repo/file', async (req, res) => {
  try {
    const { path: filePath } = req.query;
    const content = await github.getFileContent(filePath);
    res.json({ content });
  } catch (error) {
    console.error('Get file error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Railway deployment status
app.get('/api/railway/status', async (req, res) => {
  try {
    const status = await railway.getDeploymentStatus();
    res.json(status);
  } catch (error) {
    console.error('Railway status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute JSON operations manually
app.post('/api/operations/execute', async (req, res) => {
  try {
    const { operations } = req.body;
    const results = await parseAndExecuteJSON(operations);
    res.json({ results });
  } catch (error) {
    console.error('Execute operations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Request auto-fix for failed deployment
app.post('/api/railway/autofix', async (req, res) => {
  try {
    const status = await railway.getDeploymentStatus();
    
    if (status.status !== 'FAILED') {
      return res.json({ message: 'No failed deployment to fix' });
    }

    // Create prompt for DeepSeek to fix the issue
    const fixPrompt = `The deployment failed with the following error:\n\n${status.error}\n\nPlease analyze the error and provide JSON operations to fix the code. Use this format:\n\`\`\`json\n[{"action": "insert|delete", "file": "path/to/file", "line": number, "code": "code here"}]\n\`\`\``;
    
    conversationHistory.push({ role: 'user', content: fixPrompt });
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

    const response = await deepseek.chat(conversationHistory);
    
    conversationHistory.push({ role: 'assistant', content: response });
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

    res.json({ response, autoFixRequested: true });
  } catch (error) {
    console.error('Auto-fix error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear conversation history
app.post('/api/conversation/clear', (req, res) => {
  conversationHistory = [];
  res.json({ message: 'Conversation history cleared' });
});

// Extract JSON operations from response
function extractJSONOperations(text) {
  const jsonBlocks = [];
  const codeBlockRegex = /```json\s*([\s\S]*?)```/g;
  let match;
  
  while ((match = codeBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        jsonBlocks.push(...parsed);
      } else {
        jsonBlocks.push(parsed);
      }
    } catch (e) {
      console.error('Failed to parse JSON block:', e);
    }
  }
  
  return jsonBlocks;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
