const github = require('./github');

// Parse and execute JSON operations
async function parseAndExecuteJSON(operations) {
  if (!Array.isArray(operations)) {
    operations = [operations];
  }

  // Group operations by file
  const fileOperations = {};
  
  for (const op of operations) {
    if (!op.file || !op.action || op.line === undefined) {
      console.error('Invalid operation:', op);
      continue;
    }

    if (!fileOperations[op.file]) {
      fileOperations[op.file] = [];
    }
    
    fileOperations[op.file].push(op);
  }

  const results = [];

  // Process each file
  for (const [filePath, ops] of Object.entries(fileOperations)) {
    try {
      const result = await processFileOperations(filePath, ops);
      results.push(result);
    } catch (error) {
      results.push({
        file: filePath,
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

// Process operations for a single file
async function processFileOperations(filePath, operations) {
  // Get file content
  const fileData = await github.getFileContent(filePath);
  let lines = fileData.content.split('\n');

  // Sort operations: highest line first, and if same line, delete before insert
  operations.sort((a, b) => {
    if (b.line !== a.line) {
      return b.line - a.line;
    }
    // If same line, delete (a) before insert (b)
    if (a.action === 'delete' && b.action === 'insert') return -1;
    if (a.action === 'insert' && b.action === 'delete') return 1;
    return 0;
  });

  // Execute operations
  for (const op of operations) {
    if (op.action === 'delete') {
      lines = deleteAtLine(lines, op.line, op.code);
    } else if (op.action === 'insert') {
      lines = insertAtLine(lines, op.line, op.code);
    }
  }

  // Update file on GitHub
  const newContent = lines.join('\n');
  const updateResult = await github.updateFile(
    filePath, 
    newContent, 
    fileData.sha,
    `Applied ${operations.length} operation(s) via chat interface`
  );

  return {
    file: filePath,
    success: true,
    operations: operations.length,
    commit: updateResult.commit
  };
}

// Delete code at specific line
function deleteAtLine(lines, lineNumber, codeToDelete) {
  const index = lineNumber - 1; // Convert to 0-based index
  
  if (index < 0 || index >= lines.length) {
    throw new Error(`Line ${lineNumber} out of range`);
  }

  const deleteLines = codeToDelete.split('\n');
  
  // Check if the code matches
  for (let i = 0; i < deleteLines.length; i++) {
    if (index + i >= lines.length || lines[index + i] !== deleteLines[i]) {
      throw new Error(`Code at line ${lineNumber} does not match expected content`);
    }
  }

  // Remove the lines
  lines.splice(index, deleteLines.length);
  
  return lines;
}

// Insert code at specific line
function insertAtLine(lines, lineNumber, codeToInsert) {
  const index = lineNumber - 1; // Convert to 0-based index
  
  if (index < 0 || index > lines.length) {
    throw new Error(`Line ${lineNumber} out of range`);
  }

  const insertLines = codeToInsert.split('\n');
  
  // Insert the lines
  lines.splice(index, 0, ...insertLines);
  
  return lines;
}

module.exports = {
  parseAndExecuteJSON
};
