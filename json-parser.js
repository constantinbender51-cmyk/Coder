[file name]: json-parser.js
[file content begin]
const github = require('./github');

// Parse and execute JSON operations
async function parseAndExecuteJSON(operations) {
  if (!Array.isArray(operations)) {
    operations = [operations];
  }

  // Group operations by file and type
  const fileOperations = {};
  const createOperations = [];
  const deleteFileOperations = [];
  
  for (const op of operations) {
    // Validate operation
    if (!op.file || !op.action) {
      console.error('Invalid operation:', op);
      continue;
    }

    // Handle different action types
    if (op.action === 'create') {
      if (!op.content) {
        console.error('Create operation missing content:', op);
        continue;
      }
      createOperations.push(op);
      continue;
    }

    if (op.action === 'delete_file') {
      deleteFileOperations.push(op);
      continue;
    }

    if (op.action === 'insert' || op.action === 'delete') {
      if (op.line === undefined || op.code === undefined) {
        console.error('Invalid insert/delete operation:', op);
        continue;
      }

      if (!fileOperations[op.file]) {
        fileOperations[op.file] = [];
      }
      
      fileOperations[op.file].push(op);
    }
  }

  const results = [];

  // Process operations in order: delete files, modify files, create files
  try {
    // 1. Delete files first
    for (const op of deleteFileOperations) {
      const result = await deleteFile(op.file);
      results.push(result);
    }

    // 2. Process file modifications (insert/delete)
    for (const [filePath, ops] of Object.entries(fileOperations)) {
      try {
        const result = await processFileOperations(filePath, ops);
        results.push(result);
      } catch (error) {
        results.push({
          file: filePath,
          action: 'modify',
          success: false,
          error: error.message
        });
      }
    }

    // 3. Create new files last
    for (const op of createOperations) {
      const result = await createFile(op.file, op.content);
      results.push(result);
    }

  } catch (error) {
    console.error('Error processing operations:', error);
    results.push({
      success: false,
      error: error.message
    });
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
    action: 'modify',
    success: true,
    operations: operations.length,
    commit: updateResult.commit
  };
}

// Create a new file
async function createFile(filePath, content) {
  try {
    // Check if file already exists
    try {
      const existingFile = await github.getFileContent(filePath);
      // If we get here, file exists - update it instead
      const updateResult = await github.updateFile(
        filePath,
        content,
        existingFile.sha,
        `Created/updated file via chat interface`
      );
      
      return {
        file: filePath,
        action: 'create',
        success: true,
        message: 'File updated (already existed)',
        commit: updateResult.commit
      };
    } catch (error) {
      // File doesn't exist, create it
      if (error.message.includes('404') || error.message.includes('Not Found')) {
        const createResult = await github.createFile(
          filePath,
          content,
          `Created new file via chat interface`
        );
        
        return {
          file: filePath,
          action: 'create',
          success: true,
          message: 'File created successfully',
          commit: createResult.commit
        };
      }
      throw error;
    }
  } catch (error) {
    console.error('Create file error:', error);
    return {
      file: filePath,
      action: 'create',
      success: false,
      error: error.message
    };
  }
}

// Delete a file
async function deleteFile(filePath) {
  try {
    // Get file info first to get SHA
    const fileData = await github.getFileContent(filePath);
    
    const deleteResult = await github.deleteFile(
      filePath,
      fileData.sha,
      `Deleted file via chat interface`
    );
    
    return {
      file: filePath,
      action: 'delete_file',
      success: true,
      message: 'File deleted successfully',
      commit: deleteResult.commit
    };
  } catch (error) {
    console.error('Delete file error:', error);
    return {
      file: filePath,
      action: 'delete_file',
      success: false,
      error: error.message
    };
  }
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
[file content end]
