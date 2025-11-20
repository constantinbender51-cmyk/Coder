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

// System prompt for DeepSeek
const SYSTEM_PROMPT = `You are an AI assistant that helps with code editing through JSON operations.

When you need to modify code files, you must respond with JSON operations in this exact format:

\`\`\`json
[
  {
    "action": "insert",
    "file": "path/to/file.js",
    "line": 10,
    "code": "const newVariable = 'value';"
  },
  {
    "action": "delete",
    "file": "path/to/file.js",
    "line": 15,
    "code": "const oldVariable = 'old';"
  }
]
\`\`\`

RULES:
1. Two actions only: "insert" or "delete"
2. "insert" - Adds code at the specified line number
3. "delete" - Removes code that EXACTLY matches the "code" field at the specified line
4. Operations are processed from highest line number to lowest (to avoid line shifts)
5. If insert and delete target the same line, delete happens first (this replaces the line)
6. For delete operations, the "code" field must EXACTLY match what's in the file
7. Line numbers are 1-based (first line is 1, not 0)

EXAMPLES:

Replace a line:
\`\`\`json
[
  {"action": "delete", "file": "config.js", "line": 5, "code": "const port = 3000;"},
  {"action": "insert", "file": "config.js", "line": 5, "code": "const port = 8080;"}
]
\`\`\`

Add multiple lines:
\`\`\`json
[
  {"action": "insert", "file": "app.js", "line": 10, "code": "// New comment\\nconst x = 1;\\nconst y = 2;"}
]
\`\`\`

Always wrap JSON operations in \`\`\`json code blocks.`;

// Store conversation history (in-memory, last 10 messages)
let conversationHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
const MAX_HISTORY = 10;

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    // Add user message to history (keep system prompt)
    conversationHistory.push({ role: 'user', content: message });
    if (conversationHistory.length > MAX_HISTORY + 1) {
      // Keep system prompt + last MAX_HISTORY messages
      conversationHistory = [
        conversationHistory[0], // system prompt
        ...conversationHistory.slice(-(MAX_HISTORY))
      ];
    }

    // Get response from DeepSeek
    const response = await deepseek.chat(conversationHistory);
    
    // Add assistant response to history
    conversationHistory.push({ role: 'assistant', content: response });
    if (conversationHistory.length > MAX_HISTORY + 1) {
      conversationHistory = [
        conversationHistory[0],
        ...conversationHistory.slice(-(MAX_HISTORY))
      ];
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
    
    if (status.status !== 'FAILED' && status.status !== 'CRASHED') {
      return res.json({ message: 'No failed deployment to fix' });
    }

    // Create prompt for DeepSeek to fix the issue
    const errorInfo = `BUILD LOGS:\n${status.buildLogs}\n\nDEPLOYMENT LOGS:\n${status.deploymentLogs}`;
    const fixPrompt = `The deployment failed. Here are the logs:\n\n${errorInfo}\n\nPlease analyze the error and provide JSON operations to fix the code. Remember to use the exact format with "action", "file", "line", and "code" fields.`;
    
    conversationHistory.push({ role: 'user', content: fixPrompt });
    if (conversationHistory.length > MAX_HISTORY + 1) {
      conversationHistory = [
        conversationHistory[0],
        ...conversationHistory.slice(-(MAX_HISTORY))
      ];
    }

    const response = await deepseek.chat(conversationHistory);
    
    conversationHistory.push({ role: 'assistant', content: response });
    if (conversationHistory.length > MAX_HISTORY + 1) {
      conversationHistory = [
        conversationHistory[0],
        ...conversationHistory.slice(-(MAX_HISTORY))
      ];
    }

    res.json({ response, autoFixRequested: true });
  } catch (error) {
    console.error('Auto-fix error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear conversation history
app.post('/api/conversation/clear', (req, res) => {
  conversationHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
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
