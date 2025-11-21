
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
const menuToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');

let lastDeploymentStatus = null;
let currentSpeech = null;
let isSpeechSupported = false;
// ADD THIS LINE:
let handledFailureIds = new Set();


// Check speech synthesis support
function checkSpeechSupport() {
    isSpeechSupported = 'speechSynthesis' in window;
    if (!isSpeechSupported) {
        console.log('Speech synthesis not supported in this browser');
    }
}

// Initialize
checkSpeechSupport();
loadFiles();
checkDeploymentStatus();

// Set up periodic deployment check
setInterval(checkDeploymentStatus, 30000); // Check every 30 seconds

// Mobile menu toggle
menuToggle.addEventListener('click', () => {
    sidebar.classList.toggle('active');
});

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
        if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('active');
        }
    }
});

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
            
            // Auto-play TTS for assistant response
            if (isSpeechSupported) {
                speakText(data.response);
            }
            
            if (data.operations) {
                const successful = data.operations.filter(op => op.success).length;
                const failed = data.operations.filter(op => !op.success).length;
                
                let opsMessage = '';
                if (successful > 0) opsMessage += `✓ Success: ${successful} `;
                if (failed > 0) opsMessage += `✗ Failed: ${failed}`;
                
                if (!opsMessage) opsMessage = 'No operations performed';
                
                addMessage('system', opsMessage);
                
                // If there were failures, print them to the chat so you can see WHY
                if (failed > 0) {
                    const errors = data.operations
                        .filter(op => !op.success)
                        .map(op => `- ${op.file}: ${op.error || 'Unknown error'}`)
                        .join('\n');
                    addMessage('system', `Errors:\n${errors}`);
                }

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
    
    const headerDiv = document.createElement('div');
    headerDiv.className = 'message-header';
    
    const roleSpan = document.createElement('span');
    roleSpan.className = 'message-role';
    roleSpan.textContent = role === 'user' ? 'You' : 'Assistant';
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    // FIX: Split content by code blocks to handle formatting correctly
    // This regex captures the content inside backticks, including the backticks
    const parts = content.split(/(```[\s\S]*?```)/g);
    
    const formattedParts = parts.map(part => {
        if (part.startsWith('```')) {
            // It is a code block
            // Extract language and code
            const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
            const lang = match[1] || '';
            const code = match[2] || '';
            
            // Escape HTML in code to prevent rendering tags
            const safeCode = escapeHtml(code);
            
            return `<pre><code class="${lang}">${safeCode}</code></pre>`;
        } else {
            // It is regular text
            // Escape HTML first (prevents <div...> from rendering)
            // THEN replace newlines with <br>
            return escapeHtml(part).replace(/\n/g, '<br>');
        }
    });
    
    contentDiv.innerHTML = formattedParts.join('');
    
    // Add TTS button for assistant messages
    if (role === 'assistant' && isSpeechSupported) {
        const ttsButton = document.createElement('button');
        ttsButton.className = 'tts-button';
        ttsButton.innerHTML = '🔊';
        ttsButton.title = 'Read aloud';
        ttsButton.addEventListener('click', () => {
            speakText(getTextContent(content));
        });
        actionsDiv.appendChild(ttsButton);
    }
    
    headerDiv.appendChild(roleSpan);
    headerDiv.appendChild(actionsDiv);
    
    messageDiv.appendChild(headerDiv);
    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Speak text using Web Speech API
function speakText(text) {
    // Stop any current speech
    if (currentSpeech) {
        window.speechSynthesis.cancel();
    }
    
    // Clean text - remove code blocks and markdown
    const cleanText = getTextContent(text);
    
    if (!cleanText.trim()) return;
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 0.8;
    
    utterance.onstart = () => {
        // Add visual indicator that speech is playing
        const ttsButtons = document.querySelectorAll('.tts-button');
        ttsButtons.forEach(btn => btn.classList.add('playing'));
    };
    
    utterance.onend = () => {
        const ttsButtons = document.querySelectorAll('.tts-button');
        ttsButtons.forEach(btn => btn.classList.remove('playing'));
        currentSpeech = null;
    };
    
    utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event);
        const ttsButtons = document.querySelectorAll('.tts-button');
        ttsButtons.forEach(btn => btn.classList.remove('playing'));
        currentSpeech = null;
    };
    
    currentSpeech = utterance;
    window.speechSynthesis.speak(utterance);
}

// Extract clean text content (remove markdown and code blocks)
function getTextContent(text) {
    // Remove code blocks
    let cleanText = text.replace(/```[\s\S]*?```/g, '');
    // Remove inline code
    cleanText = cleanText.replace(/`([^`]+)`/g, '$1');
    // Remove markdown links
    cleanText = cleanText.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Remove multiple newlines
    cleanText = cleanText.replace(/\n\s*\n/g, '\n');
    
    return cleanText.trim();
}

// Stop current speech
function stopSpeech() {
    if (currentSpeech) {
        window.speechSynthesis.cancel();
        currentSpeech = null;
    }
}

// Clear conversation
async function clearConversation() {
    if (!confirm('Clear conversation history?')) return;

    // Stop any ongoing speech
    stopSpeech();
    
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
            fileItem.addEventListener('click', () => {
                loadFileContent(file.path);
                // Close sidebar on mobile after selecting file
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('active');
                }
            });
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
        
        // Fixed: access the content property correctly
        currentFileName.textContent = filePath;
        fileContent.textContent = data.content; // Fixed: was data.content.content, now data.content
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
        
        if (data.environment) {
            statusHtml += `<div style="margin-top: 8px; font-size: 12px; color: #666;">Env: ${data.environment}</div>`;
        }
        
        deploymentStatus.innerHTML = statusHtml;
        
        // FIX: Improved trigger logic
        const isFailed = data.status === 'FAILED' || data.status === 'CRASHED';
        
        // If failed AND we haven't asked about this specific deployment ID yet
        if (isFailed && !handledFailureIds.has(data.id)) {
            showAutofixModal();
            handledFailureIds.add(data.id); // Mark this ID as handled
        }
        
        lastDeploymentStatus = data;
    } catch (error) {
        console.error(error); // Good to log the actual error
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
            
            // FIX: Handle operations reporting for Autofix
            if (data.operations) {
                const successful = data.operations.filter(op => op.success).length;
                const failed = data.operations.filter(op => !op.success).length;
                
                let opsMessage = '';
                if (successful > 0) opsMessage += `✓ Auto-fix: Executed ${successful} change(s) `;
                if (failed > 0) opsMessage += `✗ Failed: ${failed}`;
                
                addMessage('system', opsMessage);
                loadFiles(); // Refresh file list
            }

            // Auto-play TTS for autofix response
            if (isSpeechSupported) {
                speakText(data.response);
            }
        }
    } catch (error) {
        addMessage('assistant', `Error requesting autofix: ${error.message}`);
    } finally {
        sendBtn.disabled = false;
    }
}

// Utility function
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Handle page visibility change to stop speech when tab is hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden && currentSpeech) {
        stopSpeech();
    }
});
