        let currentTab = 'html';
        let currentProjectId = null;
        let autoDraftOn = localStorage.getItem('autoDraftOn') === '1';
        let isPreviewFull = false;
        let fontSize = parseInt(localStorage.getItem('editorFontSize')) || 16;
        let searchHighlightTimeout = null;
        let currentSearchIndex = -1;
        let searchMatches = [];
        let undoStack = {html: [], css: [], js: [], json: []};
        let redoStack = {html: [], css: [], js: [], json: []};
        const MAX_UNDO = 50;

        const htmlEditor = document.getElementById('htmlEditor');
        const cssEditor = document.getElementById('cssEditor');
        const jsEditor = document.getElementById('jsEditor');
        const jsonEditor = document.getElementById('jsonEditor');
        const previewFrame = document.getElementById('previewFrame');
        const tabs = document.querySelectorAll('.tab');
        const toast = document.getElementById('toast');
        const projectSidebar = document.getElementById('projectSidebar');
        const draftToggle = document.getElementById('draftToggle');
        const saveDialog = document.getElementById('saveDialog');
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        const editorPanel = document.getElementById('editorPanel');
        const searchBar = document.getElementById('searchBar');
        const searchInput = document.getElementById('searchInput');
        const replaceInput = document.getElementById('replaceInput');
        const downloadSelectBtn = document.getElementById('downloadSelectBtn');

        function updateDraftBtnText(){
            draftToggle.innerText = autoDraftOn ? "自动草稿：开" : "自动草稿：关";
            draftToggle.classList.toggle("on", autoDraftOn);
        }
        updateDraftBtnText();

        function openSaveModal(){
            document.getElementById('projectNameInput').value = '';
            saveDialog.showModal();
            document.getElementById('projectNameInput').focus();
        }
        function closeSaveModal(){
            saveDialog.close();
        }

        document.getElementById('saveProject').onclick = () => currentProjectId ? confirmSaveProject() : openSaveModal();
        document.getElementById('saveAsProject').onclick = openSaveModal;
        document.getElementById('cancelSave').onclick = closeSaveModal;
        document.getElementById('confirmSave').onclick = confirmSaveProject;
        document.getElementById('projectNameInput').addEventListener('keydown', e => {
            if(e.key === 'Enter') confirmSaveProject();
        });

        const mainToolbar = document.getElementById('mainToolbar');
        const mainWrap = document.querySelector('.main-wrap');
        let isToolbarHidden = false;
        
        fullscreenBtn.onclick = function(){
            isPreviewFull = !isPreviewFull;
            if(isPreviewFull){
                mainWrap.classList.add('fullscreen-mode');
                fullscreenBtn.textContent = '退出全屏';
            }else{
                mainWrap.classList.remove('fullscreen-mode');
                fullscreenBtn.textContent = '全屏';
            }
        };
        
        document.addEventListener('keydown', (e) => {
            if(isPreviewFull && e.key === 'Escape'){
                isPreviewFull = false;
                mainWrap.classList.remove('fullscreen-mode');
                fullscreenBtn.textContent = '全屏';
            }
        });

        let db;
        function initIndexedDB() {
            const req = indexedDB.open('HtmlPreviewDB', 1);
            req.onupgradeneeded = e => {
                db = e.target.result;
                if(!db.objectStoreNames.contains('projects')) {
                    const st = db.createObjectStore('projects', {keyPath:'id',autoIncrement:true});
                    st.createIndex('name','name');
                }
            };
            req.onsuccess = e => {
                db = e.target.result;
                renderProjectList();
                if(autoDraftOn) autoRecoverDraft();
            };
        }
        function dbAdd(store,data){return new Promise(res=>{let t=db.transaction(store,'readwrite'),o=t.objectStore(store),r=o.add(data);r.onsuccess=e=>res(e.target.result);});}
        function dbPut(store,data){return new Promise(res=>{let t=db.transaction(store,'readwrite'),o=t.objectStore(store);o.put(data).onsuccess=()=>res();});}
        function dbAll(store){return new Promise(res=>{let t=db.transaction(store,'readonly'),o=t.objectStore(store),arr=[];o.openCursor().onsuccess=e=>{let c=e.target.result;if(c){arr.push(c.value);c.continue();}else res(arr);};});}

        initIndexedDB();
        init();

        function getCurrentEditor(){
            if(currentTab==='html') return htmlEditor;
            if(currentTab==='css') return cssEditor;
            if(currentTab==='js') return jsEditor;
            if(currentTab==='json') return jsonEditor;
            return htmlEditor;
        }

        function pushUndo(){
            const ed = getCurrentEditor();
            const key = currentTab;
            undoStack[key].push(ed.value);
            if(undoStack[key].length > MAX_UNDO) undoStack[key].shift();
            redoStack[key] = [];
        }

        function undo(){
            const ed = getCurrentEditor();
            const key = currentTab;
            if(undoStack[key].length === 0){showToast('没有可撤销的','error');return;}
            redoStack[key].push(ed.value);
            ed.value = undoStack[key].pop();
            updatePreview();
            if(autoDraftOn) autoSaveDraft();
        }

        function redo(){
            const ed = getCurrentEditor();
            const key = currentTab;
            if(redoStack[key].length === 0){showToast('没有可重做的','error');return;}
            undoStack[key].push(ed.value);
            ed.value = redoStack[key].pop();
            updatePreview();
            if(autoDraftOn) autoSaveDraft();
        }

        document.getElementById('undoBtn').onclick = undo;
        document.getElementById('redoBtn').onclick = redo;

        function setFontSize(size){
            fontSize = size;
            localStorage.setItem('editorFontSize', size);
            [htmlEditor, cssEditor, jsEditor, jsonEditor].forEach(e => e.style.fontSize = size + 'px');
        }
        setFontSize(fontSize);

        document.getElementById('fontSizeToggle').onclick = () => {
            const sizes = [14, 16, 18, 20, 22, 24];
            const idx = sizes.indexOf(fontSize);
            const next = sizes[(idx + 1) % sizes.length];
            setFontSize(next);
            showToast(`字号: ${next}px`);
        };

        document.getElementById('shortcutsToggle').onclick = () => {
            document.getElementById('shortcutsHint').classList.toggle('show');
        };
        document.addEventListener('click', e => {
            if(!e.target.closest('#shortcutsHint') && !e.target.closest('#shortcutsToggle')){
                document.getElementById('shortcutsHint').classList.remove('show');
            }
        });

        function updateCursorPosition(){
            const ed = getCurrentEditor();
            const pos = ed.selectionStart;
            const text = ed.value.substring(0, pos);
            const lines = text.split('\n');
            const line = lines.length;
            const col = lines[lines.length - 1].length + 1;
            document.getElementById('cursorLine').textContent = line;
            document.getElementById('cursorCol').textContent = col;
            document.getElementById('charCount').textContent = ed.value.length;
        }

        function showAutoSaveIndicator(){
            const indicator = document.getElementById('autoSaveIndicator');
            indicator.classList.add('show');
            setTimeout(() => indicator.classList.remove('show'), 2000);
        }

        function formatCode(){
            const ed = getCurrentEditor();
            pushUndo();
            if(currentTab === 'html'){
                let html = ed.value;
                html = html.replace(/></g, '>\n<');
                const tags = [];
                let formatted = '';
                let indent = 0;
                const parts = html.split(/(?=<)/);
                for(let p of parts){
                    p = p.trim();
                    if(!p) continue;
                    if(p.startsWith('</')){
                        indent = Math.max(0, indent - 1);
                        formatted += '  '.repeat(indent) + p + '\n';
                    } else if(p.startsWith('<!--')){
                        formatted += '  '.repeat(indent) + p + '\n';
                    } else {
                        formatted += '  '.repeat(indent) + p + '\n';
                        if(!p.startsWith('<') || !p.endsWith('/>') && !p.startsWith('<')){
                            const tagMatch = p.match(/^<(\w+)/);
                            if(tagMatch && !p.endsWith('/>')){
                                const tagName = tagMatch[1];
                                if(!['img','br','hr','input','meta','link','area','base','col','embed','param','source','track','wbr'].includes(tagName.toLowerCase())){
                                    indent++;
                                }
                            }
                        }
                    }
                }
                ed.value = formatted.trim();
            } else if(currentTab === 'css'){
                let css = ed.value;
                css = css.replace(/\s*{\s*/g, ' {\n  ');
                css = css.replace(/\s*;\s*/g, ';\n  ');
                css = css.replace(/\s*}\s*/g, '\n}\n');
                css = css.replace(/  \n/g, '\n').replace(/\n\s*\n/g, '\n');
                ed.value = css.trim();
            } else if(currentTab === 'json'){
                try {
                    const obj = JSON.parse(ed.value);
                    ed.value = JSON.stringify(obj, null, 2);
                    showToast('JSON格式化成功');
                } catch(e) {
                    showToast('JSON格式错误', 'error');
                }
            }
            if(currentTab !== 'json') showToast('代码已格式化');
            updatePreview();
            if(autoDraftOn) autoSaveDraft();
        }

        document.getElementById('formatCode').onclick = formatCode;

        document.getElementById('replaceCssBtn').onclick = () => openReplaceDialog('css');
        document.getElementById('replaceJsonBtn').onclick = () => openReplaceDialog('json');

        function openReplaceDialog(type){
            const curTab = currentTab;
            switchTabByKey(type);
            searchBar.classList.remove('hidden');
            searchInput.value = '';
            replaceInput.value = '';
            searchInput.focus();
            searchMatches = [];
            currentSearchIndex = -1;
        }

        searchInput.oninput = () => performSearch(true);
        searchInput.onkeydown = e => {
            if(e.key === 'Enter'){
                if(e.shiftKey) performSearch(false);
                else performSearch(true);
            }
            if(e.key === 'Escape') closeSearchBar();
        };
        replaceInput.onkeydown = e => {
            if(e.key === 'Enter' && e.ctrlKey) doReplace();
        };

        document.getElementById('doSearchPrev').onclick = () => performSearch(false);
        document.getElementById('doSearchNext').onclick = () => performSearch(true);
        document.getElementById('doReplace').onclick = doReplace;
        document.getElementById('doReplaceAll').onclick = doReplaceAll;
        document.getElementById('closeSearch').onclick = closeSearchBar;

        function performSearch(forward = true){
            const ed = getCurrentEditor();
            const searchText = searchInput.value;
            if(!searchText){ clearHighlights(); return; }
            const content = ed.value;
            const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            const matches = [...content.matchAll(regex)];
            searchMatches = matches.map(m => m.index);
            if(searchMatches.length === 0){ clearHighlights(); showToast('未找到', 'error'); return; }
            if(forward){ currentSearchIndex = (currentSearchIndex + 1) % searchMatches.length; }
            else { currentSearchIndex = (currentSearchIndex - 1 + searchMatches.length) % searchMatches.length; }
            highlightAndScroll();
            showToast(`第${currentSearchIndex + 1}个，共${searchMatches.length}个`);
        }

        function highlightAndScroll(){
            const ed = getCurrentEditor();
            const pos = searchMatches[currentSearchIndex];
            ed.focus();
            ed.setSelectionRange(pos, pos + searchInput.value.length);
            const lineHeight = parseInt(getComputedStyle(ed).lineHeight) || 20;
            const scrollTop = Math.max(0, pos * lineHeight - ed.clientHeight / 2);
            ed.scrollTop = scrollTop;
        }

        function clearHighlights(){
            searchMatches = [];
            currentSearchIndex = -1;
        }

        function doReplace(){
            const ed = getCurrentEditor();
            const searchText = searchInput.value;
            const replaceText = replaceInput.value;
            if(currentSearchIndex < 0){ showToast('请先搜索', 'error'); return; }
            pushUndo();
            ed.value = ed.value.substring(0, searchMatches[currentSearchIndex]) + replaceText + ed.value.substring(searchMatches[currentSearchIndex] + searchText.length);
            performSearch(true);
            if(autoDraftOn) autoSaveDraft();
            updatePreview();
        }

        function doReplaceAll(){
            const ed = getCurrentEditor();
            const searchText = searchInput.value;
            const replaceText = replaceInput.value;
            if(!searchText){ showToast('请输入搜索内容', 'error'); return; }
            pushUndo();
            const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            let count = 0;
            ed.value = ed.value.replace(regex, (match) => { count++; return replaceText; });
            clearHighlights();
            showToast(`已替换 ${count} 处`);
            if(autoDraftOn) autoSaveDraft();
            updatePreview();
        }

        function closeSearchBar(){
            searchBar.classList.add('hidden');
            clearHighlights();
        }

        let selectMode = false;
        let selectedFiles = {html: true, css: true, js: true, json: true};

        downloadSelectBtn.onclick = () => {
            if(selectMode){ downloadSelected(); return; }
            selectMode = true;
            openDownloadSelectDialog();
        };

        function openDownloadSelectDialog(){
            const d = document.createElement('dialog');
            d.id = 'selectDownloadDialog';
            d.innerHTML = `
                <h3>选择要下载的内容</h3>
                <div class="form-group">
                    <label class="select-item ${htmlEditor.value.trim() ? '' : 'disabled'}" onclick="toggleSelect('html')">
                        <input type="checkbox" id="selHtml" ${selectedFiles.html ? 'checked' : ''} ${!htmlEditor.value.trim() ? 'disabled' : ''}>
                        HTML ${htmlEditor.value.trim() ? '' : '(空)'}
                    </label>
                </div>
                <div class="form-group">
                    <label class="select-item ${cssEditor.value.trim() ? '' : 'disabled'}" onclick="toggleSelect('css')">
                        <input type="checkbox" id="selCss" ${selectedFiles.css ? 'checked' : ''} ${!cssEditor.value.trim() ? 'disabled' : ''}>
                        CSS ${cssEditor.value.trim() ? '' : '(空)'}
                    </label>
                </div>
                <div class="form-group">
                    <label class="select-item ${jsEditor.value.trim() ? '' : 'disabled'}" onclick="toggleSelect('js')">
                        <input type="checkbox" id="selJs" ${selectedFiles.js ? 'checked' : ''} ${!jsEditor.value.trim() ? 'disabled' : ''}>
                        JavaScript ${jsEditor.value.trim() ? '' : '(空)'}
                    </label>
                </div>
                <div class="form-group">
                    <label class="select-item ${jsonEditor.value.trim() ? '' : 'disabled'}" onclick="toggleSelect('json')">
                        <input type="checkbox" id="selJson" ${selectedFiles.json ? 'checked' : ''} ${!jsonEditor.value.trim() ? 'disabled' : ''}>
                        JSON ${jsonEditor.value.trim() ? '' : '(空)'}
                    </label>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="cancelSelect">取消</button>
                    <button class="btn" id="confirmSelect">下载</button>
                </div>
            `;
            document.body.appendChild(d);
            d.showModal();
            document.getElementById('cancelSelect').onclick = () => { d.close(); document.body.removeChild(d); selectMode = false; };
            document.getElementById('confirmSelect').onclick = () => {
                selectedFiles.html = document.getElementById('selHtml').checked;
                selectedFiles.css = document.getElementById('selCss').checked;
                selectedFiles.js = document.getElementById('selJs').checked;
                selectedFiles.json = document.getElementById('selJson').checked;
                d.close();
                document.body.removeChild(d);
                downloadSelected();
                selectMode = false;
            };
            d.onclose = () => { if(document.body.contains(d)) document.body.removeChild(d); selectMode = false; };
        }

        window.toggleSelect = (type) => {
            const cb = document.getElementById('sel' + type.charAt(0).toUpperCase() + type.slice(1));
            if(cb && !cb.disabled) cb.checked = !cb.checked;
        };

        function downloadSelected(){
            const hasAny = selectedFiles.html && htmlEditor.value.trim() ||
                          selectedFiles.css && cssEditor.value.trim() ||
                          selectedFiles.js && jsEditor.value.trim() ||
                          selectedFiles.json && jsonEditor.value.trim();
            if(!hasAny){ showToast('没有可下载的内容', 'error'); return; }
            function download(name, content){
                const blob = new Blob([content], {type: 'text/plain'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = name;
                a.click();
                URL.revokeObjectURL(url);
            }
            if(selectedFiles.html && htmlEditor.value.trim()) download('index.html', htmlEditor.value);
            if(selectedFiles.css && cssEditor.value.trim()) download('style.css', cssEditor.value);
            if(selectedFiles.js && jsEditor.value.trim()) download('script.js', jsEditor.value);
            if(selectedFiles.json && jsonEditor.value.trim()) download('config.json', jsonEditor.value);
            showToast('下载完成');
        }

        function openFeishuConfigDialog(){
            const d = document.createElement('dialog');
            const savedToken = localStorage.getItem('feishuToken') || '';
            const savedWebhook = localStorage.getItem('feishuWebhook') || '';
            d.innerHTML = `
                <h3>飞书配置</h3>
                <div class="form-group">
                    <label class="config-label">Access Token</label>
                    <input type="text" id="feishuTokenInput" class="feishu-token-input" value="${savedToken}" placeholder="填写飞书Access Token">
                </div>
                <div class="form-group">
                    <label class="config-label">Webhook地址</label>
                    <input type="text" id="feishuWebhookInput" class="feishu-token-input" value="${savedWebhook}" placeholder="填写飞书Webhook地址">
                </div>
                <div class="form-group">
                    <label class="config-label">说明：Access Token用于API调用，Webhook用于消息推送</label>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="cancelFeishu">取消</button>
                    <button class="btn btn-secondary" id="testFeishu">测试</button>
                    <button class="btn" id="saveFeishu">保存</button>
                </div>
            `;
            document.body.appendChild(d);
            d.showModal();
            document.getElementById('cancelFeishu').onclick = () => { d.close(); document.body.removeChild(d); };
            document.getElementById('saveFeishu').onclick = () => {
                localStorage.setItem('feishuToken', document.getElementById('feishuTokenInput').value);
                localStorage.setItem('feishuWebhook', document.getElementById('feishuWebhookInput').value);
                d.close();
                document.body.removeChild(d);
                showToast('飞书配置已保存');
            };
            document.getElementById('testFeishu').onclick = async () => {
                const webhook = document.getElementById('feishuWebhookInput').value;
                if(!webhook){ showToast('请输入Webhook地址', 'error'); return; }
                try {
                    const resp = await fetch(webhook, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({msg_type: 'text', content: {text: '🎉 飞书配置测试成功！'}})
                    });
                    if(resp.ok) showToast('测试消息发送成功');
                    else showToast('发送失败', 'error');
                } catch(e){ showToast('网络错误', 'error'); }
            };
            d.onclose = () => { if(document.body.contains(d)) document.body.removeChild(d); };
        }

        document.getElementById('configFeishu').onclick = openFeishuConfigDialog;

        function openGithubConfigDialog(){
            const d = document.createElement('dialog');
            const savedToken = localStorage.getItem('githubToken') || '';
            const savedRepo = localStorage.getItem('githubRepo') || '';
            d.innerHTML = `
                <h3>GitHub配置</h3>
                <div class="form-group">
                    <label class="config-label">Personal Access Token</label>
                    <input type="password" id="githubTokenInput" class="feishu-token-input" value="${savedToken}" placeholder="填写GitHub Token">
                </div>
                <div class="form-group">
                    <label class="config-label">仓库 (owner/repo)</label>
                    <input type="text" id="githubRepoInput" class="feishu-token-input" value="${savedRepo}" placeholder="如: username/my-project">
                </div>
                <div class="form-group">
                    <label class="config-label">说明：Token需要repo权限才能创建文件</label>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="cancelGithub">取消</button>
                    <button class="btn" id="saveGithub">保存</button>
                </div>
            `;
            document.body.appendChild(d);
            d.showModal();
            document.getElementById('cancelGithub').onclick = () => { d.close(); document.body.removeChild(d); };
            document.getElementById('saveGithub').onclick = () => {
                localStorage.setItem('githubToken', document.getElementById('githubTokenInput').value);
                localStorage.setItem('githubRepo', document.getElementById('githubRepoInput').value);
                d.close();
                document.body.removeChild(d);
                showToast('GitHub配置已保存');
            };
            d.onclose = () => { if(document.body.contains(d)) document.body.removeChild(d); };
        }

        document.getElementById('configGithub').onclick = openGithubConfigDialog;

        async function sendToFeishu(){
            const webhook = localStorage.getItem('feishuWebhook');
            if(!webhook){ showToast('请先配置飞书Webhook', 'error'); openFeishuConfigDialog(); return; }
            const html = htmlEditor.value;
            const css = cssEditor.value;
            const jsonTxt = jsonEditor.value;
            let jt = '{}';
            try { jt = JSON.stringify(JSON.parse(jsonTxt)); } catch(e){}
            const page = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${css}</style>
</head>
<body>
${html}
<script>window.previewConfig=${jt};<\/script>
</body>
</html>`;
            try {
                const resp = await fetch(webhook, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        msg_type: 'interactive',
                        card: {
                            config: {wide_screen_mode: true},
                            elements: [{
                                tag: 'markdown',
                                content: `**HTML预览工作台导出**\n\`\`\`html\n${html.substring(0, 500)}${html.length > 500 ? '...' : ''}\n\`\`\``
                            }]
                        }
                    })
                });
                if(resp.ok) showToast('已发送到飞书');
                else showToast('发送失败', 'error');
            } catch(e){ showToast('网络错误', 'error'); }
        }

        async function pushToGithub(){
            const token = localStorage.getItem('githubToken');
            const repo = localStorage.getItem('githubRepo');
            if(!token || !repo){ showToast('请先配置GitHub', 'error'); openGithubConfigDialog(); return; }
            const html = htmlEditor.value;
            const css = cssEditor.value;
            const jsonTxt = jsonEditor.value;
            let jt = '{}';
            try { jt = JSON.stringify(JSON.parse(jsonTxt)); } catch(e){}
            const name = prompt('输入文件名:', 'preview.html');
            if(!name) return;
            try {
                const content = btoa(unescape(encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${css}</style>
</head>
<body>
${html}
<script>window.previewConfig=${jt};<\/script>
</body>
</html>`)));
                const resp = await fetch(`https://api.github.com/repos/${repo}/contents/${name}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message: 'Upload from HTML Preview Studio', content })
                });
                if(resp.ok){
                    const data = await resp.json();
                    showToast('已上传到GitHub');
                } else {
                    const err = await resp.json();
                    showToast(err.message || '上传失败', 'error');
                }
            } catch(e){ showToast('网络错误', 'error'); }
        }

        function init() {
            tabs.forEach(t=>t.onclick=switchTab);
            [htmlEditor,cssEditor,jsEditor,jsonEditor].forEach(el=>{
                let isFirstInput = true;
                el.oninput = ()=>{
                    if(isFirstInput){
                        pushUndo();
                        isFirstInput = false;
                    }
                    updatePreview();
                    updateCursorPosition();
                    if(autoDraftOn) autoSaveDraft();
                };
                el.onclick = ()=> updateCursorPosition();
                el.onkeyup = ()=> {
                    updateCursorPosition();
                    isFirstInput = true;
                };
                el.onkeydown = e => {
                    if(e.ctrlKey && e.key === 'z'){ e.preventDefault(); undo(); isFirstInput = true; }
                    if(e.ctrlKey && e.key === 'y'){ e.preventDefault(); redo(); isFirstInput = true; }
                    if(e.ctrlKey && e.key === 's'){ e.preventDefault(); currentProjectId ? confirmSaveProject() : openSaveModal(); }
                    if(e.ctrlKey && e.key === 'f'){ e.preventDefault(); searchBar.classList.toggle('hidden'); if(!searchBar.classList.contains('hidden')) searchInput.focus(); }
                    if(e.key === 'Tab'){
                        e.preventDefault();
                        pushUndo();
                        const start = el.selectionStart;
                        const end = el.selectionEnd;
                        el.value = el.value.substring(0, start) + '  ' + el.value.substring(end);
                        el.selectionStart = el.selectionEnd = start + 2;
                        updatePreview();
                    }
                };
            });

            draftToggle.onclick = ()=>{
                autoDraftOn = !autoDraftOn;
                localStorage.setItem('autoDraftOn', autoDraftOn ? '1' : '0');
                updateDraftBtnText();
                autoDraftOn ? autoSaveDraft() : localStorage.removeItem('previewDraft');
                showToast(autoDraftOn ? "已开启自动草稿" : "已关闭自动草稿并清除");
            };

            document.getElementById('toggleSidebar').onclick = ()=>{
                projectSidebar.classList.toggle('sidebar-show');
            };

            const moreActionsBtn = document.getElementById('moreActionsBtn');
            const toolbarActions = document.getElementById('toolbarActions');
            const toolbarOverlay = document.getElementById('toolbarOverlay');
            
            function showMobileMenu() {
                toolbarActions.classList.add('mobile-show');
                toolbarOverlay.classList.add('show');
                document.body.style.overflow = 'hidden';
            }
            
            function hideMobileMenu() {
                toolbarActions.classList.remove('mobile-show');
                toolbarOverlay.classList.remove('show');
                document.body.style.overflow = '';
            }
            
            moreActionsBtn.onclick = (e) => {
                e.stopPropagation();
                if(toolbarActions.classList.contains('mobile-show')){
                    hideMobileMenu();
                } else {
                    showMobileMenu();
                }
            };
            
            toolbarOverlay.onclick = hideMobileMenu;
            
            document.addEventListener('click', (e) => {
                if(!e.target.closest('.toolbar-actions') && !e.target.closest('#moreActionsBtn')){
                    hideMobileMenu();
                }
            });

            function updateMobileUI(){
                const isMobile = window.innerWidth < 768;
                moreActionsBtn.style.display = isMobile ? 'block' : 'none';
                toolbarActions.classList.remove('mobile-show');
            }
            updateMobileUI();
            window.addEventListener('resize', updateMobileUI);

            document.getElementById('newProject').onclick = newProject;
            document.getElementById('refreshProject').onclick = renderProjectList;
            document.getElementById('clearAllBtn').onclick = clearAllContent;
            document.getElementById('refreshPreview').onclick = updatePreview;

            const mainWrap = document.querySelector('.main-wrap');
            const editorPanel = document.querySelector('.editor-panel');

            document.getElementById('importFileBtn').onclick=()=>document.getElementById('fileInput').click();
            document.getElementById('fileInput').onchange=handleImportFile;

            document.getElementById('downloadAllBtn').onclick=downloadAllNow;
            document.getElementById('mergeExportBtn').onclick=mergeExportHtml;
            document.getElementById('splitHtmlBtn').onclick=splitHtmlToThree;
            document.getElementById('cleanCommentBtn').onclick=cleanAllComment;

            updatePreview();
        }

        function switchTab(e){
            currentTab = e.target.dataset.tab;
            tabs.forEach(t=>t.classList.remove('active'));
            e.target.classList.add('active');
            htmlEditor.classList.add('hidden');
            cssEditor.classList.add('hidden');
            jsEditor.classList.add('hidden');
            jsonEditor.classList.add('hidden');
            if(currentTab==='html')htmlEditor.classList.remove('hidden');
            if(currentTab==='css')cssEditor.classList.remove('hidden');
            if(currentTab==='js')jsEditor.classList.remove('hidden');
            if(currentTab==='json')jsonEditor.classList.remove('hidden');
        }

        function updatePreview(){
            const html = htmlEditor.value;
            const css = cssEditor.value;
            const js = jsEditor.value;
            let jt = jsonEditor.value.trim();
            let jsonObj = {};
            try{jt=jt?JSON.stringify(JSON.parse(jt)):'{}';jsonObj=jt?JSON.parse(jt):{};}catch(e){jt='{}';}
            const page = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${css}</style>
</head>
<body>
${html}
<script>window.previewConfig=${jt};<\/script>
<script>${js}<\/script>
</body>
</html>`;
            const doc = previewFrame.contentDocument;
            doc.open();doc.write(page);doc.close();
        }

        function clearAllContent(){
            htmlEditor.value='';cssEditor.value='';jsEditor.value='';jsonEditor.value='';
            currentProjectId=null;
            if(!autoDraftOn) localStorage.removeItem('previewDraft');
            updatePreview();
            showToast('已清空');
        }

        async function renderProjectList(){
            const list = await dbAll('projects');
            const wrap = document.getElementById('projectList');
            wrap.innerHTML='';
            list.sort((a,b)=>b.createTime-a.createTime);
            list.forEach(item=>{
                const div = document.createElement('div');
                div.className = 'project-item'+(item.id===currentProjectId?' active':'');
                div.innerHTML = `
                    <div>${item.name}</div>
                    <div class="project-time">${fmtTime(item.createTime)}</div>
                    <div class="project-ops">
                        <span class="mini-btn" onclick="loadProj(${item.id})">加载</span>
                        <span class="mini-btn" onclick="delProj(${item.id})">删除</span>
                    </div>
                `;
                wrap.appendChild(div);
            });
        }
        function fmtTime(t){
            const d=new Date(t);
            return `${d.getMonth()+1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
        }
        window.loadProj = async id=>{
            const list = await dbAll('projects');
            const item = list.find(x=>x.id===id);
            if(!item)return;
            currentProjectId = item.id;
            htmlEditor.value=item.html||'';
            cssEditor.value=item.css||'';
            jsEditor.value=item.js||'';
            jsonEditor.value=item.json||'';
            updatePreview();renderProjectList();
            showToast('已加载');
        };
        // 修复删除
        window.delProj = async id=>{
            if(!confirm('确定删除？'))return;
            const t = db.transaction('projects','readwrite');
            const st = t.objectStore('projects');
            st.delete(id);
            t.oncomplete = async ()=>{
                if(currentProjectId===id)currentProjectId=null;
                await renderProjectList();
                showToast('已删除');
            };
            t.onerror = ()=>{
                showToast('删除失败','error');
            };
        };

        function newProject(){clearAllContent();showToast('新建空白项目');}

        async function confirmSaveProject(){
            const name = document.getElementById('projectNameInput').value.trim();
            if(!name)return showToast('请输入项目名','error');
            const data = {
                name,html:htmlEditor.value,css:cssEditor.value,js:jsEditor.value,json:jsonEditor.value,
                createTime:Date.now()
            };
            if(currentProjectId){
                data.id = currentProjectId;
                await dbPut('projects',data);
                showToast('已更新');
            }else{
                currentProjectId = await dbAdd('projects',data);
                showToast('已保存');
            }
            closeSaveModal();
            renderProjectList();
        }

        function autoSaveDraft(){
            const d = {html:htmlEditor.value,css:cssEditor.value,js:jsEditor.value,json:jsonEditor.value};
            localStorage.setItem('previewDraft',JSON.stringify(d));
            showAutoSaveIndicator();
        }
        function autoRecoverDraft(){
            const s = localStorage.getItem('previewDraft');
            if(!s)return;
            const d = JSON.parse(s);
            htmlEditor.value = d.html||'';
            cssEditor.value = d.css||'';
            jsEditor.value = d.js||'';
            jsonEditor.value = d.json||'';
            updatePreview();
        }

        function handleImportFile(e){
            const files = e.target.files;
            if(!files.length)return;
            for(let f of files){
                const ext = f.name.split('.').pop().toLowerCase();
                const reader = new FileReader();
                reader.onload=evt=>{
                    const txt = evt.target.result;
                    if(ext==='html'||ext==='htm'){htmlEditor.value=txt;switchTabByKey('html');}
                    if(ext==='css'){cssEditor.value=txt;switchTabByKey('css');}
                    if(ext==='json'){jsonEditor.value=txt;switchTabByKey('json');}
                    if(ext==='js'){jsEditor.value=txt;switchTabByKey('js');}
                    updatePreview();
                    if(autoDraftOn) autoSaveDraft();
                };
                reader.readAsText(f);
            }
            document.getElementById('fileInput').value='';
            showToast('导入成功');
        }
        function switchTabByKey(key){
            currentTab = key;
            tabs.forEach(t=>{
                if(t.dataset.tab===key) t.click();
            });
        }

        function downloadAllNow(){
            function download(name,content){
                const blob = new Blob([content],{type:'text/plain'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;a.download = name;
                a.click();
                URL.revokeObjectURL(url);
            }
            if(htmlEditor.value.trim()) download('index.html',htmlEditor.value);
            if(cssEditor.value.trim()) download('style.css',cssEditor.value);
            if(jsEditor.value.trim()) download('script.js',jsEditor.value);
            if(jsonEditor.value.trim()) download('config.json',jsonEditor.value);
            showToast('一键下载完成');
        }

        function mergeExportHtml(){
            const html = htmlEditor.value;
            const css = cssEditor.value.trim();
            const js = jsEditor.value.trim();
            const jsonTxt = jsonEditor.value.trim();
            let styleBlock = css ? `<style>\n${css}\n</style>\n` : '';
            let jsonBlock = '';
            if(jsonTxt){
                try{
                    const jsonObj = JSON.parse(jsonTxt);
                    jsonBlock = `<script>window.previewConfig = ${JSON.stringify(jsonObj,null,2)};<\/script>\n`;
                }catch(e){
                    return showToast('JSON格式错误','error');
                }
            }
            let jsBlock = js ? `<script>\n${js}\n<\/script>\n` : '';
            const merged = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0,user-scalable=no">
${styleBlock}
</head>
<body>
${html}
${jsonBlock}
${jsBlock}
</body>
</html>`;
            const blob = new Blob([merged],{type:'text/html'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;a.download = 'merged_index.html';
            a.click();
            URL.revokeObjectURL(url);
            showToast('合并导出成功');
        }

        function splitHtmlToThree(){
            let full = htmlEditor.value;
            let cssContent = '';
            let jsContent = '';
            let jsonContent = '';
            
            const styleReg = /<style\s*[^>]*>([\s\S]*?)<\/style>/gi;
            const styleMatch = full.match(styleReg);
            if(styleMatch){
                cssContent = styleMatch.map(item => {
                    return item.replace(/<style\s*[^>]*>|<\/style>/gi, '').trim();
                }).join('\n\n');
                full = full.replace(styleReg, '').trim();
            }
            
            const scriptReg = /<script\s*[^>]*>([\s\S]*?)<\/script>/gi;
            const scriptMatches = [];
            let scriptMatch;
            const scriptCopy = full;
            while((scriptMatch = scriptReg.exec(scriptCopy)) !== null){
                scriptMatches.push(scriptMatch[1]);
            }
            
            const jsonReg = /(?:window\.)?(previewConfig|previewJson)\s*=\s*(\{[\s\S]*?\});?/gi;
            const jsonMatch = full.match(jsonReg);
            if(jsonMatch){
                let jsonStr = jsonMatch[0].replace(/(?:window\.)?(previewConfig|previewJson)\s*=|;$/g, '').trim();
                try{
                    jsonContent = JSON.stringify(JSON.parse(jsonStr), null, 2);
                }catch(e){}
                full = full.replace(jsonReg, '').trim();
            }
            
            full = full.replace(/<script\s*[^>]*>[\s\S]*?<\/script>/gi, '').trim();
            
            const remainingScripts = scriptMatches.filter(s => {
                return !s.includes('previewConfig') && !s.includes('previewJson');
            });
            if(remainingScripts.length > 0){
                jsContent = remainingScripts.join('\n\n');
            }
            
            htmlEditor.value = full || '';
            cssEditor.value = cssContent || '';
            jsEditor.value = jsContent || '';
            jsonEditor.value = jsonContent || '';
            if(autoDraftOn) autoSaveDraft();
            switchTabByKey('html');
            updatePreview();
            showToast('拆分完成');
        }

        function cleanAllComment(){
            htmlEditor.value = htmlEditor.value.replace(/<!--[\s\S]*?-->/g,'').replace(/\n\s*\n/g,'\n').trim();
            cssEditor.value = cssEditor.value.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\n\s*\n/g,'\n').trim();
            jsEditor.value = jsEditor.value
                .replace(/\/\*[\s\S]*?\*\//g,'')
                .replace(/\/\/[^\n]*/g,'')
                .replace(/\n\s*\n/g,'\n').trim();
            jsonEditor.value = jsonEditor.value
                .replace(/\/\*[\s\S]*?\*\//g,'')
                .replace(/\/\/[^\n]*/g,'')
                .replace(/\n\s*\n/g,'\n').trim();
            if(autoDraftOn) autoSaveDraft();
            updatePreview();
            showToast('已清理注释');
        }

        function showToast(msg,type='success'){
            toast.textContent=msg;
            toast.className=`toast ${type} show`;
            setTimeout(()=>toast.classList.remove('show'),3000);
        }
