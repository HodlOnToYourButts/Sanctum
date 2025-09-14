// Admin page functionality
let currentUser = null;

async function checkAdminAuth() {
    try {
        const response = await fetch('/user');
        if (!response.ok) {
            throw new Error('Not authenticated');
        }

        const user = await response.json();
        console.log('User data:', user); // Debug log

        if (!user.roles.includes('admin')) {
            throw new Error(`Insufficient privileges. Current roles: ${user.roles.join(', ')}`);
        }

        currentUser = user;
        document.getElementById('admin-name').textContent = user.name;
        document.getElementById('auth-check').style.display = 'none';
        document.getElementById('admin-content').style.display = 'block';

        // Load initial data
        await loadSiteSettings();
        await loadContent();

    } catch (error) {
        document.getElementById('auth-check').innerHTML =
            `<div class="error">Access denied: ${error.message}. <a href="/">Return to homepage</a></div>`;
    }
}

async function loadSiteSettings() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            document.getElementById('site-name').value = settings.name || 'Sanctum CMS';
            document.getElementById('site-description').value = settings.description || '';
        }
    } catch (error) {
        console.error('Failed to load site settings:', error);
    }
}

async function saveSiteSettings(formData) {
    try {
        const response = await fetch('/api/settings', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: formData.get('name'),
                description: formData.get('description')
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save settings');
        }

        showMessage('site-message', 'Settings saved successfully!', 'success');
    } catch (error) {
        showMessage('site-message', `Error: ${error.message}`, 'error');
    }
}

async function loadContent() {
    try {
        const response = await fetch('/api/content');
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const content = await response.json();
        console.log('Loaded content:', content); // Debug log
        displayContent(content);
        document.getElementById('content-loading').style.display = 'none';
    } catch (error) {
        console.error('Content loading error:', error);
        document.getElementById('content-loading').innerHTML =
            `<div class="error">Failed to load content: ${error.message}</div>`;
    }
}

function displayContent(contentList) {
    const container = document.getElementById('content-list');

    if (contentList.length === 0) {
        container.innerHTML = '<p class="loading">No content found. Create your first piece of content above!</p>';
        return;
    }

    container.innerHTML = contentList.map(item => `
        <div class="content-item">
            <h4>${escapeHtml(item.title)}</h4>
            <div class="content-meta">
                Type: ${item.type} |
                Created: ${new Date(item.created_at).toLocaleDateString()} |
                Author: ${escapeHtml(item.author_name || 'Unknown')}
            </div>
            ${item.tags ? `<div>${item.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
            <div style="margin: 1rem 0; color: #6b7280; font-size: 0.875rem;">
                ${escapeHtml(item.body.substring(0, 150))}${item.body.length > 150 ? '...' : ''}
            </div>
            <div class="content-actions">
                <button class="btn" onclick="editContent('${item._id}')">Edit</button>
                <button class="btn btn-danger" onclick="deleteContent('${item._id}')">Delete</button>
                ${item.type === 'blog' ? `<button class="btn btn-secondary" onclick="viewComments('${item._id}')">Comments</button>` : ''}
            </div>
        </div>
    `).join('');
}

async function createContent(formData) {
    try {
        const contentData = {
            type: formData.get('type'),
            title: formData.get('title'),
            body: formData.get('body')
        };

        if (contentData.type === 'blog' && formData.get('tags')) {
            contentData.tags = formData.get('tags').split(',').map(tag => tag.trim()).filter(tag => tag);
        }

        const response = await fetch('/api/content', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(contentData)
        });

        if (!response.ok) {
            throw new Error('Failed to create content');
        }

        showMessage('content-message', 'Content created successfully!', 'success');
        document.getElementById('content-form').reset();
        document.getElementById('tags-group').style.display = 'none';
        await loadContent();
    } catch (error) {
        showMessage('content-message', `Error: ${error.message}`, 'error');
    }
}

async function deleteContent(contentId) {
    if (!confirm('Are you sure you want to delete this content?')) {
        return;
    }

    try {
        const response = await fetch(`/api/content/${contentId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to delete content');
        }

        showMessage('content-message', 'Content deleted successfully!', 'success');
        await loadContent();
    } catch (error) {
        showMessage('content-message', `Error: ${error.message}`, 'error');
    }
}

function editContent(contentId) {
    // TODO: Implement edit functionality
    alert('Edit functionality coming soon!');
}

function viewComments(contentId) {
    // TODO: Implement comment viewing
    alert('Comment management coming soon!');
}

function showMessage(elementId, message, type) {
    const element = document.getElementById(elementId);
    element.innerHTML = `<div class="${type}">${message}</div>`;
    setTimeout(() => {
        element.innerHTML = '';
    }, 5000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function logout() {
    try {
        const response = await fetch('/logout', { method: 'POST' });
        if (response.ok) {
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Logout failed:', error);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', checkAdminAuth);

document.getElementById('site-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    await saveSiteSettings(formData);
});

document.getElementById('content-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    await createContent(formData);
});

document.getElementById('content-type').addEventListener('change', (e) => {
    const tagsGroup = document.getElementById('tags-group');
    if (e.target.value === 'blog') {
        tagsGroup.style.display = 'block';
    } else {
        tagsGroup.style.display = 'none';
    }
});