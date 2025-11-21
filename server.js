
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const extractJson = require('extract-json-from-string');

const deepseek = require('./deepseek');
const github = require('./github');
const railway = require('./railway');
const { parseAndExecuteJSON } = require('./json-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
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
  },
  {
    "action": "create",
    "file": "path/to/newfile.js",
    "content": "// New file content\\nconst example = 'hello';"
  },
  {
    "action": "delete_file",
    "file": "path/to/oldfile.js"
  }
]
\`\`\`

RULES:
1. Four actions available: "insert", "delete", "create", "delete_file"
2. "insert" - Adds code at the specified line number
3. "delete" - Removes code that EXACTLY matches the "code" field at the specified line
4. "create" - Creates a new file with the specified content
5. "delete_file" - Deletes an entire file
6. Operations are processed in this order: delete_file, delete, insert, create
7. For delete operations, the "code" field must EXACTLY match what's in the file
8. Line numbers are 1-based (first line is 1, not 0)
9. For "create" action, use "content" field instead of "code"
10. For "delete_file" action, only "file" field is needed

EXAMPLES:

Create a new file:
\`\`\`json
[
  {"action": "create", "file": "utils/helpers.js", "content": "// Helper functions\\nexport function formatDate(date) {\\n  return date.toISOString();\\n}"}
]
\`\`\`

Delete a file:
\`\`\`json
[
  {"action": "delete_file", "file": "old-config.js"}
]
\`\`\`

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

If you're providing commands, configuration, or other non-JSON responses, just provide them as regular text.

Always wrap JSON operations in \`\`\`json code blocks.`;

// Store conversation history (in-memory, last 10 messages)
let conversationHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
const MAX_HISTORY = 10;

// Cache for file contents to avoid repeated GitHub API calls
let fileCache = new Map();
const CACHE_TTL = 60000; // 1 minute

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    // Get current file structure and contents for context
    const fileContext = await getFileContext();
    
    // Create enhanced prompt with file context
    const enhancedMessage = `${message}\n\nCURRENT FILES AND CONTEXT:\n${fileContext}`;
    
    // Add user message to history (keep system prompt)
    conversationHistory.push({ role: 'user', content: enhancedMessage });
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

    // Check if response contains JSON operations using extract-json-from-string
    const jsonOperations = extractJSONOperations(response);
    console.log('Extracted JSON operations:', jsonOperations.length);
    
    if (jsonOperations.length > 0) {
      try {
        const results = await parseAndExecuteJSON(jsonOperations);
        
        // Clear file cache since files were modified
        fileCache.clear();
        
        return res.json({ 
          response, 
          operations: results,
          message: `Executed ${results.filter(r => r.success).length} operation(s)`
        });
      } catch (error) {
        console.error('Error executing operations:', error);
        // Return the response anyway, but with error info
        return res.json({ 
          response,
          error: `Failed to execute operations: ${error.message}`
        });
      }
    }

    res.json({ response });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get file context for DeepSeek
async function getFileContext() {
  try {
    const files = await github.listFiles();
    let context = `Repository contains ${files.length} files:\n\n`;
    
    // Get contents of key files (limit to important ones to avoid token limits)
    const importantFiles = files.filter(file => 
      file.path.match(/\.(js|ts|json|html|css|md|txt|yml|yaml|xml|py|rb|java|c|cpp|go|rs|php)$/) && 
      !file.path.includes('node_modules') &&
      !file.path.includes('.git') &&
      file.size < 10000 // Only files under 10KB
    ).slice(0, 10); // Limit to 10 files to avoid token overflow
    
    for (const file of importantFiles) {
      try {
        let content;
        
        // Check cache first
        if (fileCache.has(file.path) && 
            Date.now() - fileCache.get(file.path).timestamp < CACHE_TTL) {
          content = fileCache.get(file.path).content;
        } else {
          const fileData = await github.getFileContent(file.path);
          content = fileData.content;
          // Cache the content
          fileCache.set(file.path, {
            content: content,
            timestamp: Date.now()
          });
        }
        
        context += `FILE: ${file.path} (${file.size} bytes)\n`;
        context += `CONTENT:\n\`\`\`\n${content}\n\`\`\`\n\n`;
        
      } catch (error) {
        context += `FILE: ${file.path} (Error reading: ${error.message})\n\n`;
      }
    }
    
    // Add remaining file list without content
    const otherFiles = files.filter(file => 
      !importantFiles.some(imp => imp.path === file.path)
    );
    
    if (otherFiles.length > 0) {
      context += `OTHER FILES (${otherFiles.length}):\n`;
      otherFiles.forEach(file => {
        context += `- ${file.path} (${file.size} bytes)\n`;
      });
    }
    
    return context;
  } catch (error) {
    console.error('Error getting file context:', error);
    return 'Unable to load file context. Please check repository access.';
  }
}

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
    res.json({ content: content.content });
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

    // Get file context for better autofix
    const fileContext = await getFileContext();
    
    // Create enhanced prompt for DeepSeek to fix the issue
    const errorInfo = `BUILD LOGS:\n${status.buildLogs}\n\nDEPLOYMENT LOGS:\n${status.deploymentLogs}`;
    const fixPrompt = `The deployment failed. Here are the logs:\n\n${errorInfo}\n\nCURRENT FILES AND CONTEXT:\n${fileContext}\n\nPlease analyze the error and provide JSON operations to fix the code. Remember to use the exact format with "action", "file", "line", and "code" fields. You can create new files or delete problematic files if needed.`;
    
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

    // Clear file cache since autofix might modify files
    fileCache.clear();

    res.json({ response, autoFixRequested: true });
  } catch (error) {
    console.error('Auto-fix error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear conversation history
app.post('/api/conversation/clear', (req, res) => {
  conversationHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
  fileCache.clear(); // Clear file cache as well
  res.json({ message: 'Conversation history cleared' });
});

// Clear file cache endpoint
app.post('/api/cache/clear', (req, res) => {
  fileCache.clear();
  res.json({ message: 'File cache cleared' });
});

// Extract JSON operations from response using extract-json-from-string library
function extractJSONOperations(text) {
  if (!text) return [];
  
  try {
    console.log('Extracting JSON from response...');
    
    // Use extract-json-from-string library to find all JSON in the text
    const jsonBlocks = extractJson(text);
    console.log(`Found ${jsonBlocks.length} JSON blocks`);
    
    const operations = [];
    
    for (const jsonBlock of jsonBlocks) {
      try {
        // The library returns already parsed JSON objects
        const parsed = jsonBlock;
        
        // Handle array of operations
        if (Array.isArray(parsed)) {
          const validOperations = parsed.filter(op => 
            op && typeof op === 'object' && op.action && op.file
          );
          if (validOperations.length > 0) {
            console.log(`Found ${validOperations.length} valid operations in array`);
            operations.push(...validOperations);
          }
        } 
        // Handle single operation object
        else if (parsed.action && parsed.file) {
          console.log('Found single operation object');
          operations.push(parsed);
        }
      } catch (parseError) {
        console.log('Failed to process JSON block:', parseError.message);
        continue;
      }
    }
    
    console.log(`Total valid operations extracted: ${operations.length}`);
    return operations;
    
  } catch (error) {
    console.error('Error extracting JSON:', error);
    return [];
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
