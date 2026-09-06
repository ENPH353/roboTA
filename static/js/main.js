import { API } from './api.js';

// --- APPLICATION STATE ---
const state = {
    allChats: {},
    activeChatId: null,
    editingChatId: null,
    cloudModelName: "LiteLLM",
    ollamaModelName: "Local Ollama",
    activeStudentId: sessionStorage.getItem('verified_student_id'),
    activeStreams: {},
    stagedFiles: []
};

// --- DOM ELEMENTS ---
const elements = {
    chatWindow: document.getElementById('chatWindow'),
    chatList: document.getElementById('chatList'),
    projectSelect: document.getElementById('projectSelect'),
    loginOverlay: document.getElementById('loginOverlay'),
    fileInput: document.getElementById('fileInput'),
    filePreviewContainer: document.getElementById('filePreviewContainer'),
    filePreviewTray: document.getElementById('filePreviewTray'),
    userInput: document.getElementById('userInput'),
    attachBtn: document.getElementById('attachBtn'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn')
};

marked.setOptions({ breaks: true, gfm: true });

// --- INITIALIZATION ---
async function init() {
    await checkAuth();
    await loadConfig();
    
    const stored = localStorage.getItem('chatbot_chats');
    if (stored) state.allChats = JSON.parse(stored);
    
    const finalizedId = localStorage.getItem('chatbot_active_id');
    if (finalizedId && state.allChats[finalizedId]) {
        state.activeChatId = finalizedId;
        const projectPart = finalizedId.split('_').slice(1, -1).join('_');
        
        if (['lab_1', 'lab_2', 'lab_3', 'lab_4', 'lab_5', 'lab_6', 'lab_7', 'lab_8', 'competition', 'lit_review'].includes(projectPart)) {
            elements.projectSelect.value = projectPart;
        }
    } else {
        createNewChat();
    }
    
    renderChatList();
    renderActiveChat();
    updateNetworkStatus();
}

// --- AUTHENTICATION ---
async function checkAuth() {
    try {
        const data = await API.checkAutoLogin();
        if (data.saved) {
            state.activeStudentId = data.student_id;
            sessionStorage.setItem('verified_student_id', data.student_id);
        }
    } catch (e) {}

    if (state.activeStudentId) {
        elements.loginOverlay.style.display = 'none';
        updateStudentDisplay();
    } else {
        elements.loginOverlay.style.display = 'flex';
        updateStudentDisplay();
    }
}

function updateStudentDisplay() {
    const studentDisplay = document.getElementById('studentDisplay');
    studentDisplay.textContent = state.activeStudentId ? `Logged in as: ${state.activeStudentId}` : '';
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const errorDiv = document.getElementById('loginError');
    const input = document.getElementById('studentIdInput').value.trim();
    
    errorDiv.style.display = 'none';
    btn.textContent = 'Verifying...';

    const isValid = await API.verifyStudent(input);
    if (isValid) {
        sessionStorage.setItem('verified_student_id', input);
        state.activeStudentId = input;
        elements.loginOverlay.style.display = 'none';
        updateStudentDisplay();
    } else {
        errorDiv.textContent = 'Invalid Student Number. Access denied.';
        errorDiv.style.display = 'block';
    }
    btn.textContent = 'Enter Application';
});

document.getElementById('forgetBtn').onclick = async () => {
    if (confirm("Forget saved Student ID and log out?")) {
        await API.logout();
        sessionStorage.removeItem('verified_student_id');
        state.activeStudentId = null;
        window.location.reload();
    }
};

// --- CORE CHAT LOGIC ---
function saveState() {
    localStorage.setItem('chatbot_chats', JSON.stringify(state.allChats));
    localStorage.setItem('chatbot_active_id', state.activeChatId);
}

function createNewChat() {
    const currentProject = elements.projectSelect.value;
    const newId = `chat_${currentProject}_${Date.now()}`;
    
    state.allChats[newId] = {
        id: newId,
        title: "New Conversation",
        createdAt: new Date().toLocaleString(),
        messages: []
    };
    state.activeChatId = newId;
    saveState();
    renderChatList();
    renderActiveChat();
}

function deleteChat(id, event) {
    event.stopPropagation(); 
    delete state.allChats[id];
    
    const currentProject = elements.projectSelect.value;
    const projectChats = Object.keys(state.allChats).filter(key => key.startsWith(`chat_${currentProject}_`));

    if (projectChats.length === 0) {
        createNewChat();
    } else if (state.activeChatId === id) {
        projectChats.sort((a, b) => b.split('_').pop() - a.split('_').pop());
        state.activeChatId = projectChats[0];
    }
    
    saveState();
    renderChatList();
    renderActiveChat();
}

// RESTORED: Chat List with Edit/Delete features
function renderChatList() {
    elements.chatList.innerHTML = '';
    const currentProject = elements.projectSelect.value;
    const projectKeys = Object.keys(state.allChats).filter(id => id.startsWith(`chat_${currentProject}_`));

    projectKeys.sort((a, b) => b.split('_').pop() - a.split('_').pop()).forEach(id => {
        const chat = state.allChats[id];
        const item = document.createElement('div');
        item.className = `chat-item ${id === state.activeChatId ? 'active' : ''}`;
        item.onclick = () => {
            if (state.editingChatId) return;
            state.activeChatId = id;
            saveState();
            renderChatList();
            renderActiveChat();
        };

        if (id === state.editingChatId) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'chat-title-input';
            input.value = chat.title;
            input.onclick = (e) => e.stopPropagation();

            const saveEdit = () => {
                const newTitle = input.value.trim();
                if (newTitle) {
                    state.allChats[id].title = newTitle;
                    saveState();
                }
                state.editingChatId = null;
                renderChatList();
            };

            input.onblur = saveEdit;
            input.onkeydown = (e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') {
                    state.editingChatId = null;
                    renderChatList();
                }
            };

            item.appendChild(input);
            setTimeout(() => input.focus(), 0);
        } else {
            const titleSpan = document.createElement('span');
            titleSpan.className = "chat-title-text";
            titleSpan.textContent = chat.title;
            titleSpan.ondblclick = (e) => {
                e.stopPropagation();
                state.editingChatId = id;
                renderChatList();
            };

            const actionContainer = document.createElement('div');
            actionContainer.className = "action-btns";

            const editBtn = document.createElement('button');
            editBtn.className = "edit-btn";
            editBtn.textContent = "✎";
            editBtn.onclick = (e) => {
                e.stopPropagation();
                state.editingChatId = id;
                renderChatList();
            };

            const delBtn = document.createElement('button');
            delBtn.className = "delete-btn";
            delBtn.textContent = "×";
            delBtn.onclick = (e) => deleteChat(id, e);

            actionContainer.appendChild(editBtn);
            actionContainer.appendChild(delBtn);
            item.appendChild(titleSpan);
            item.appendChild(actionContainer);
        }
        elements.chatList.appendChild(item);
    });
}

function isScrolledToBottom(element) {
    const threshold = 10; 
    return element.scrollHeight - element.clientHeight - element.scrollTop <= threshold;
}

// RESTORED: Full active chat rendering including Stream status
function renderActiveChat() {
    elements.chatWindow.innerHTML = '';
    const activeChat = state.allChats[state.activeChatId];
    if (!activeChat) return;

    activeChat.messages.forEach(msg => {
        const msgDiv = document.createElement('div');
        if (msg.role === 'user') {
            msgDiv.className = "message user-msg";
            msgDiv.textContent = msg.content;
            if (msg.inputTokens) {
                const meta = document.createElement('div');
                meta.className = "meta-info";
                meta.style.color = "rgba(255, 255, 255, 0.75)";
                meta.textContent = `${msg.inputTokens} input tokens`;
                msgDiv.appendChild(meta);
            }
        } else {
            msgDiv.className = "message bot-msg";
            if (msg.source) {
                const headerDiv = document.createElement('div');
                headerDiv.className = "bot-header";
                headerDiv.textContent = `${msg.source} ${msg.outputTokens ? `• ${msg.outputTokens} tokens` : ''}`;
                msgDiv.appendChild(headerDiv);
            }
            const textDiv = document.createElement('div');
            textDiv.className = "text-zone";
            textDiv.innerHTML = marked.parse(msg.content);
            msgDiv.appendChild(textDiv);
        }
        elements.chatWindow.appendChild(msgDiv);
    });

    const stream = state.activeStreams[state.activeChatId];
    if (stream) {
        elements.sendBtn.style.display = "none";
        elements.stopBtn.style.display = "block";

        const botMsgDiv = document.createElement('div');
        botMsgDiv.className = "message bot-msg";
        botMsgDiv.id = `active-stream-${state.activeChatId}`;

        const headerDiv = document.createElement('div');
        headerDiv.className = `bot-header ${stream.source ? '' : 'hidden'}`;
        headerDiv.textContent = stream.source || '';
        botMsgDiv.appendChild(headerDiv);

        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = `thinking-zone ${stream.thoughts ? '' : 'hidden'}`;
        thinkingDiv.textContent = stream.thoughts || '';
        botMsgDiv.appendChild(thinkingDiv);

        const textDiv = document.createElement('div');
        textDiv.className = "text-zone";
        textDiv.innerHTML = stream.text ? marked.parse(stream.text) : "Thinking...";
        botMsgDiv.appendChild(textDiv);

        elements.chatWindow.appendChild(botMsgDiv);
    } else {
        elements.sendBtn.style.display = "block";
        elements.stopBtn.style.display = "none";
    }

    elements.chatWindow.scrollTop = elements.chatWindow.scrollHeight;
}

// --- RESTORED: MULTI-FILE & STAGING LOGIC ---
function renderStagedFiles() {
    elements.filePreviewContainer.innerHTML = '';
    
    if (state.stagedFiles.length === 0) {
        elements.filePreviewTray.style.display = "none";
        elements.userInput.required = true;
        return;
    }

    elements.filePreviewTray.style.display = "block";
    elements.userInput.required = false;

    state.stagedFiles.forEach((file, index) => {
        const chip = document.createElement('div');
        chip.className = 'file-chip';
        chip.textContent = file.name;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'file-chip-remove';
        removeBtn.textContent = '×';
        removeBtn.onclick = () => {
            state.stagedFiles.splice(index, 1);
            renderStagedFiles();
        };

        chip.appendChild(removeBtn);
        elements.filePreviewContainer.appendChild(chip);
    });
}

elements.attachBtn.onclick = () => elements.fileInput.click();

elements.fileInput.onchange = () => {
    if (elements.fileInput.files.length > 0) {
        for (let i = 0; i < elements.fileInput.files.length; i++) {
            state.stagedFiles.push(elements.fileInput.files[i]);
        }
        elements.fileInput.value = ''; 
        renderStagedFiles();
    }
};

elements.userInput.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let filePasted = false;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            const fileName = file.name || `pasted_image_${Date.now()}.png`;
            state.stagedFiles.push(new File([file], fileName, { type: file.type }));
            filePasted = true;
        }
    }
    if (filePasted) {
        renderStagedFiles();
        e.preventDefault();
    }
});


// --- RESTORED: SUBMISSION & STREAMING ENGINE ---
document.getElementById('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const textValue = elements.userInput.value;
    const targetChatId = state.activeChatId;
    const activeChat = state.allChats[targetChatId];
    
    // RESTORED: File Badge Injection
    const userMsg = { role: "user", content: textValue, timestamp: new Date().toLocaleString() };
    if (state.stagedFiles.length > 0) {
        const names = state.stagedFiles.map(f => f.name).join(', ');
        userMsg.content = `[📎 Attached Files: ${names}]\n\n` + textValue;
    }
    activeChat.messages.push(userMsg);

    // Auto-rename chat
    if (activeChat.title === "New Conversation" && textValue.trim() !== '') {
        activeChat.title = textValue.substring(0, 24) + (textValue.length > 24 ? "..." : "");
    }
    
    elements.userInput.value = '';
    saveState();
    renderChatList();

    const formData = new FormData();
    formData.append('messages', JSON.stringify(activeChat.messages));
    formData.append('project_id', elements.projectSelect.value);
    if (state.activeStudentId) formData.append('student_id', state.activeStudentId);
    formData.append('model_preference', document.getElementById('modelToggle').checked ? 'local' : 'cloud');

    const tempVal = document.getElementById('tempInput').value;
    const topPVal = document.getElementById('topPInput').value;
    const topKVal = document.getElementById('topKInput').value;
    if (tempVal !== '') formData.append('temperature', tempVal);
    if (topPVal !== '') formData.append('top_p', topPVal);
    if (topKVal !== '') formData.append('top_k', topKVal);
    
    // RESTORED: Attaching staged files to Payload
    if (state.stagedFiles.length > 0) {
        for (let file of state.stagedFiles) formData.append('file', file); 
    }

    const controller = new AbortController();
    state.activeStreams[targetChatId] = {
        controller: controller,
        thoughts: "",
        text: "",
        source: "",
        inputTokens: 0,
        outputTokens: 0
    };

    renderActiveChat();

    try {
        const response = await API.streamChat(formData, controller.signal);
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.indexOf('\n');

            while (boundary !== -1) {
                const line = buffer.substring(0, boundary).trim();
                buffer = buffer.substring(boundary + 1);

                if (line) {
                    try {
                        const data = JSON.parse(line);
                        const streamState = state.activeStreams[targetChatId];
                        if (!streamState) break;

                        if (data.t === "thinking") streamState.thoughts += data.c;
                        else if (data.t === "text") streamState.text += data.c;
                        else if (data.t === "source") streamState.source = data.c;
                        else if (data.t === "usage") {
                            if (data.input_tokens) streamState.inputTokens = data.input_tokens;
                            if (data.output_tokens) streamState.outputTokens = data.output_tokens;
                        }

                        if (state.activeChatId === targetChatId) {
                            const activeContainer = document.getElementById(`active-stream-${targetChatId}`);
                            if (activeContainer) {
                                const headerDiv = activeContainer.querySelector('.bot-header');
                                const thinkingDiv = activeContainer.querySelector('.thinking-zone');
                                const textDiv = activeContainer.querySelector('.text-zone');

                                if (streamState.source) {
                                    headerDiv.textContent = streamState.source;
                                    headerDiv.classList.remove('hidden');
                                }
                                if (streamState.thoughts) {
                                    thinkingDiv.textContent = streamState.thoughts;
                                    thinkingDiv.classList.remove('hidden');
                                }
                                if (streamState.text) {
                                    textDiv.innerHTML = marked.parse(streamState.text);
                                }
                            }
                            // RESTORED: Auto-scroll
                            if (isScrolledToBottom(elements.chatWindow)) {
                                elements.chatWindow.scrollTop = elements.chatWindow.scrollHeight;
                            }
                        }
                    } catch (e) {}
                }
                boundary = buffer.indexOf('\n');
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            state.activeStreams[targetChatId].text += "\n\n*[Generation stopped by user]*";
        } else {
            state.activeStreams[targetChatId].text = `Connection Error: ${error.message}`;
        }
    } finally {
        const finalState = state.activeStreams[targetChatId];
        
        if (finalState && finalState.inputTokens) {
            userMsg.inputTokens = finalState.inputTokens;
        }
        if (finalState && finalState.text) {
            activeChat.messages.push({ 
                role: "assistant", 
                content: finalState.text,
                source: finalState.source,
                timestamp: new Date().toLocaleString(),
                inputTokens: finalState.inputTokens,
                outputTokens: finalState.outputTokens
            });
            saveState();
        }

        delete state.activeStreams[targetChatId];
        state.stagedFiles = [];
        renderStagedFiles();
        renderChatList();

        if (state.activeChatId === targetChatId) renderActiveChat();
    }
});


// --- RESTORED: CONTROLS & EXPORTS ---
elements.stopBtn.onclick = () => {
    if (state.activeStreams[state.activeChatId]) {
        state.activeStreams[state.activeChatId].controller.abort();
    }
};

document.getElementById('newChatBtn').onclick = createNewChat;
elements.projectSelect.onchange = () => {
    const currentProject = elements.projectSelect.value;
    const projectChats = Object.keys(state.allChats).filter(id => id.startsWith(`chat_${currentProject}_`));

    if (projectChats.length > 0) {
        projectChats.sort((a, b) => b.split('_').pop() - a.split('_').pop());
        state.activeChatId = projectChats[0];
    } else {
        createNewChat();
    }
    saveState();
    renderChatList();
    renderActiveChat();
};

document.getElementById('exportBtn').onclick = async () => {
    const exportBtn = document.getElementById('exportBtn');
    const currentProject = elements.projectSelect.value;
    const projectLabel = elements.projectSelect.options[elements.projectSelect.selectedIndex].text;
    
    const projectChats = {};
    Object.keys(state.allChats).forEach(id => {
        if (id.startsWith(`chat_${currentProject}_`)) projectChats[id] = state.allChats[id];
    });

    if (Object.keys(projectChats).length === 0) {
        alert("No chats found in this project to export.");
        return;
    }

    exportBtn.disabled = true;
    exportBtn.textContent = "Processing...";

    try {
        const result = await API.exportProject({
            project_id: currentProject,
            project_label: projectLabel,
            chats: projectChats,
            student_id: state.activeStudentId
        });
        alert(`Project Exported Successfully!\nSaved to: ${result.filepath}`);
    } catch (err) {
        alert(`Export Error: ${err.message}`);
    } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = "<span>Export Lab Chats</span>";
    }
};

// UI Toggles
document.getElementById('modelToggle').addEventListener('change', (e) => {
    const label = document.getElementById('activeModelLabel');
    if (e.target.checked) {
        label.textContent = state.ollamaModelName;
        label.style.color = "#6c757d"; 
    } else {
        label.textContent = state.cloudModelName;
        label.style.color = "#007bff"; 
    }
});

async function loadConfig() {
    const cfg = await API.fetchConfig();
    if (cfg) {
        state.cloudModelName = `LiteLLM (${cfg.cloud_model})`;
        state.ollamaModelName = `Local Ollama (${cfg.ollama_model})`;
    }
    document.getElementById('modelToggle').dispatchEvent(new Event('change'));
}

function updateNetworkStatus() {
    const statusDiv = document.getElementById('networkStatus');
    if (navigator.onLine) {
        statusDiv.textContent = "Network: Online";
        statusDiv.className = "status online";
    } else {
        statusDiv.textContent = "Network: Offline (Forcing Local Fallback)";
        statusDiv.className = "status offline";
    }
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

init();