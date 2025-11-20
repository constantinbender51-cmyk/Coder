const axios = require('axios');

const GITHUB_API_URL = 'https://api.github.com';
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;

const api = axios.create({
  baseURL: GITHUB_API_URL,
  headers: {
    'Authorization': `token ${TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  }
});

// List all files in repo recursively
async function listFiles(path = '') {
  try {
    const response = await api.get(`/repos/${REPO}/contents/${path}`);
    const items = response.data;
    let files = [];

    for (const item of items) {
      if (item.type === 'file') {
        files.push({
          path: item.path,
          name: item.name,
          size: item.size,
          sha: item.sha
        });
      } else if (item.type === 'dir') {
        const subFiles = await listFiles(item.path);
        files = files.concat(subFiles);
      }
    }

    return files;
  } catch (error) {
    console.error('GitHub list files error:', error.response?.data || error.message);
    throw new Error('Failed to list repository files');
  }
}

// Get file content
async function getFileContent(filePath) {
  try {
    const response = await api.get(`/repos/${REPO}/contents/${filePath}`);
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
    return {
      content,
      sha: response.data.sha,
      path: filePath
    };
  } catch (error) {
    console.error('GitHub get file error:', error.response?.data || error.message);
    throw new Error(`Failed to get file: ${filePath}`);
  }
}

// Update file content
async function updateFile(filePath, content, sha, message = 'Update file via chat interface') {
  try {
    const encodedContent = Buffer.from(content).toString('base64');
    
    const response = await api.put(`/repos/${REPO}/contents/${filePath}`, {
      message,
      content: encodedContent,
      sha: sha
    });

    return {
      success: true,
      path: filePath,
      commit: response.data.commit.sha
    };
  } catch (error) {
    console.error('GitHub update file error:', error.response?.data || error.message);
    throw new Error(`Failed to update file: ${filePath}`);
  }
}

module.exports = {
  listFiles,
  getFileContent,
  updateFile
};
