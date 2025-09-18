// Global state
let currentUser = null;
let isEditMode = false;
let postId = null;

// Determine if we're in edit mode or create mode
function initializeMode() {
    const path = window.location.pathname;
    const pathParts = path.split('/').filter(part => part);

    if (pathParts.includes('edit')) {
        isEditMode = true;
        postId = pathParts[pathParts.length - 1];
        document.getElementById('page-title').textContent = 'Edit Forum Post | Sanctum';
        document.title = 'Edit Forum Post | Sanctum';
        document.getElementById('page-heading').textContent = 'Edit Forum Post';
    } else {
        isEditMode = false;
        document.getElementById('page-title').textContent = 'Create Forum Post | Sanctum';
        document.title = 'Create Forum Post | Sanctum';
        document.getElementById('page-heading').textContent = 'Create New Forum Post';

        // Pre-select category if provided in URL path: /forums/create/general
        if (pathParts.length >= 3 && pathParts[0] === 'forums' && pathParts[1] === 'create') {
            const categorySlug = pathParts[2];
            document.getElementById('forum-category').value = categorySlug;
        }
    }
}

async function checkAuth() {
    try {
        const response = await fetch('/user');
        if (response.ok) {
            const user = await response.json();
            showLoggedInState(user);

            if (isEditMode) {
                await loadPostForEdit();
            } else {
                showEditForm();
            }
        } else if (response.status === 401) {
            showError('You must be logged in to create or edit forum posts.');
        } else {
            console.warn('Auth check returned unexpected status:', response.status);
            showError('Authentication error. Please try logging in again.');
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        showError('Failed to verify authentication. Please try refreshing the page.');
    }
}

function showLoggedInState(user) {
    currentUser = user;
    document.getElementById('user-name-header').textContent = user.name || 'User';
    document.getElementById('user-info').classList.add('show');

    let authButtons = '<button class="auth-button logout" onclick="logout()">Logout</button>';

    if (user.roles && user.roles.includes('admin')) {
        authButtons = '<a href="/admin" class="auth-button">Admin</a>' + authButtons;
    }

    document.getElementById('auth-section').innerHTML = authButtons;
}

async function logout() {
    try {
        const response = await fetch('/logout', {
            method: 'POST',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                if (result.logoutUrl) {
                    window.location.href = result.logoutUrl;
                } else {
                    window.location.href = '/login';
                }
            } else {
                console.error('Logout failed:', result.error);
            }
        } else {
            console.error('Logout failed');
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
}

async function loadPostForEdit() {
    try {
        const response = await fetch(`/api/content/${postId}`);

        if (!response.ok) {
            if (response.status === 404) {
                showError('Forum post not found.');
                return;
            }
            throw new Error('Failed to load forum post');
        }

        const post = await response.json();

        // Check if user can edit this post
        const isAuthor = currentUser.id === post.author_id;
        const isModerator = currentUser.roles.includes('admin') || currentUser.roles.includes('moderator');

        if (!isAuthor && !isModerator) {
            showError('You do not have permission to edit this forum post.');
            return;
        }

        // Populate form with existing data
        document.getElementById('forum-category').value = post.category || '';
        document.getElementById('forum-title').value = post.title || '';
        document.getElementById('forum-body').value = post.body || '';
        document.getElementById('allow-comments').checked = post.allow_comments !== false;

        showEditForm();

    } catch (error) {
        console.error('Error loading post for edit:', error);
        showError('Failed to load forum post for editing.');
    }
}

function showEditForm() {
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('edit-container').style.display = 'block';
}

function showError(message) {
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('edit-container').style.display = 'none';
    document.getElementById('error-message').textContent = message;
    document.getElementById('error-container').style.display = 'block';
}

function cancelEdit() {
    if (isEditMode) {
        window.location.href = `/forums/view/${postId}`;
    } else {
        window.location.href = '/forums';
    }
}

// Handle form submission
document.getElementById('forum-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const category = document.getElementById('forum-category').value;
    const title = document.getElementById('forum-title').value.trim();
    const body = document.getElementById('forum-body').value.trim();
    const allowComments = document.getElementById('allow-comments').checked;

    if (!category || !title || !body) {
        alert('Please fill in all required fields.');
        return;
    }

    const saveButton = document.querySelector('.btn-save');
    const originalText = saveButton.textContent;
    saveButton.textContent = 'Saving...';
    saveButton.disabled = true;

    try {
        const postData = {
            type: 'forum',
            category: category,
            title: title,
            body: body,
            allow_comments: allowComments,
            status: 'published'
        };

        let response;
        if (isEditMode) {
            // Update existing post
            response = await fetch(`/api/content/${postId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(postData)
            });
        } else {
            // Create new post
            response = await fetch('/api/content', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(postData)
            });
        }

        if (response.ok) {
            const result = await response.json();
            const resultId = result._id || result.id || postId;

            alert(isEditMode ? 'Forum post updated successfully!' : 'Forum post created successfully!');
            window.location.href = `/forums/view/${resultId}`;
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save forum post');
        }

    } catch (error) {
        console.error('Error saving forum post:', error);
        alert(`Failed to ${isEditMode ? 'update' : 'create'} forum post: ${error.message}`);

        saveButton.textContent = originalText;
        saveButton.disabled = false;
    }
});

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    initializeMode();
    await checkAuth();
});