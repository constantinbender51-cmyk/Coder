const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');
const fileList = document.getElementById('fileList');
const refreshFilesBtn = document.getElementById('refreshFilesBtn');
const refreshStatusBtn = document.getElementById('refreshStatusBtn');
const deploymentStatus = document.getElementById('deploymentStatus');
const fileViewer = document.getElementById('fileViewer');
const fileContent = document.getElementById('fileContent');
const currentFileName = document.getElementById('currentFileName');
const closeFileBtn = document.getElementById('closeFileBtn');
const autofixModal = document.getElementById('autofixModal');
const autofixYes = document.getElementById('autofixYes');
const autofixNo = document.getElementById('autofixNo');

let lastDeploymentStatus = null;

// Initialize
loadFiles();
checkDeploymentStatus();

// Set up periodic deployment check
setInterval(checkDeploymentStatus, 30000); // Check every 30 seconds

// Event listeners
sendBtn.addEventListener('click', sendMessage);
clearBtn.addEventListener('click', clearConversation);
refreshFilesBtn.addEventListener('click', loadFiles);
refreshStatusBtn.addEventListener('click', checkDeploymentStatus);
closeFileBtn.addEventListener('click', () => {
    fileViewer.style.display = 'none';
});

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

autofixYes.addEventListener('click', async () => {
    autofixModal.style.display = 'none';
    await requestAutofix();
});

autofixNo.addEventListener('click', () => {
    autofixModal.style.display = 'none';
});

// Send message
async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    addMessage('user', message);
    chatInput.value = '';
    sendBtn.disabled = true;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        const data = await response.json();

        if (data.error) {
            addMessage('assistant', `Error: ${data.error}`);
        } else {
            addMessage('assistant', data.response);
            
            if (data.operations) {
                const opsMessage = `✓ Executed ${data.operations.length} operation(s) on GitHub`;
                addMessage('system', opsMessage);
                loadFiles(); // Refresh file list
            }
        }
    } catch (error) {
        addMessage('assistant', `Error: ${error.message}`);
    } finally {
        sendBtn.disabled = false;
        chatInput.focus();
    }
}

// Add message to chat
function addMessage(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    // Format code blocks
    content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
    });
    
    contentDiv.innerHTML = content.replace(/\n/g, '<br>');
    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Clear conversation
async function clearConversation() {
    if (!confirm('Clear conversation history?')) return;

    try {
        await fetch('/api/conversation/clear', { method: 'POST' });
        chatMessages.innerHTML = '';
        addMessage('system', 'Conversation cleared');
    } catch (error) {
        addMessage('system', `Error clearing conversation: ${error.message}`);
    }
}

// Load repository files
async function loadFiles() {
    fileList.innerHTML = '<div style="padding: 10px; color: #999;">Loading...</div>';
    
    try {
        const response = await fetch('/api/repo/files');
        const data = await response.json();
        
        if (data.error) {
            fileList.innerHTML = `<div style="padding: 10px; color: #c62828;">Error: ${data.error}</div>`;
            return;
        }
        
        fileList.innerHTML = '';
        data.files.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.textContent = file.path;
            fileItem.addEventListener('click', () => loadFileContent(file.path));
            fileList.appendChild(fileItem);
        });
    } catch (error) {
        fileList.innerHTML = `<div style="padding: 10px; color: #c62828;">Error loading files</div>`;
    }
}

// Load file content
async function loadFileContent(filePath) {
    try {
        const response = await fetch(`/api/repo/file?path=${encodeURIComponent(filePath)}`);
        const data = await response.json();
        
        if (data.error) {
            alert(`Error loading file: ${data.error}`);
            return;
        }
        
        currentFileName.textContent = filePath;
        fileContent.textContent = data.content;
        fileViewer.style.display = 'block';
    } catch (error) {
        alert(`Error loading file: ${error.message}`);
    }
}

// Check deployment status
async function checkDeploymentStatus() {
    try {
        const response = await fetch('/api/railway/status');
        const data = await response.json();
        
        if (data.error) {
            deploymentStatus.innerHTML = `<div style="color: #c62828;">Error: ${data.error}</div>`;
            return;
        }
        
        let statusClass = '';
        switch (data.status) {
            case 'SUCCESS':
            case 'ACTIVE':
                statusClass = 'status-success';
                break;
            case 'FAILED':
            case 'CRASHED':
                statusClass = 'status-failed';
                break;
            case 'BUILDING':
            case 'DEPLOYING':
                statusClass = 'status-building';
                break;
        }
        
        let statusHtml = `
            <div><strong class="${statusClass}">${data.status}</strong></div>
            <div style="margin-top: 8px; font-size: 12px; color: #666;">
                ${new Date(data.createdAt).toLocaleString()}
            </div>
        `;
        
        if (data.url) {
            statusHtml += `<div style="margin-top: 8px;"><a href="${data.url}" target="_blank" style="font-size: 12px;">View Deployment</a></div>`;
        }
        
        deploymentStatus.innerHTML = statusHtml;
        
        // Check if deployment just failed
        if ((data.status === 'FAILED' || data.status === 'CRASHED') && 
            lastDeploymentStatus && lastDeploymentStatus.id !== data.id) {
            showAutofixModal();
        }
        
        lastDeploymentStatus = data;
    } catch (error) {
        deploymentStatus.innerHTML = `<div style="color: #c62828;">Error checking status</div>`;
    }
}

// Show autofix modal
function showAutofixModal() {
    autofixModal.style.display = 'flex';
}

// Request autofix
async function requestAutofix() {
    addMessage('system', 'Requesting automatic fix from DeepSeek...');
    sendBtn.disabled = true;
    
    try {
        const response = await fetch('/api/railway/autofix', { method: 'POST' });
        const data = await response.json();
        
        if (data.error) {
            addMessage('assistant', `Error: ${data.error}`);
        } else {
            addMessage('assistant', data.response);
        }
    } catch (error) {
        addMessage('assistant', `Error requesting autofix: ${error.message}`);
    } finally {
        sendBtn.disabled = false;
    }
}

// Utility function
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
