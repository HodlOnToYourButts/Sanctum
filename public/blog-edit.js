// Global state
let currentUser = null;
let isEditMode = false;
let blogId = null;

// Determine if we're in edit mode or create mode
function initializeMode() {
    const path = window.location.pathname;

    if (path.includes('/edit/')) {
        isEditMode = true;
        blogId = path.split('/').pop();
        document.getElementById('page-title').textContent = 'Edit Blog | Sanctum';
        document.title = 'Edit Blog | Sanctum';
        document.getElementById('page-heading').textContent = 'Edit Blog';
    } else {
        isEditMode = false;
        document.getElementById('page-title').textContent = 'Create Blog | Sanctum';
        document.title = 'Create Blog | Sanctum';
        document.getElementById('page-heading').textContent = 'Create New Blog';
    }
}

async function checkAuth() {
    try {
        const response = await fetch('/user');
        if (response.ok) {
            const user = await response.json();
            showLoggedInState(user);

            if (isEditMode) {
                await loadBlogForEdit();
            } else {
                showEditForm();
            }
        } else if (response.status === 401) {
            showError('You must be logged in to create or edit blogs.');
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

async function loadBlogForEdit() {
    try {
        const response = await fetch(`/api/content/${blogId}`);

        if (!response.ok) {
            if (response.status === 404) {
                showError('Blog post not found.');
                return;
            }
            throw new Error('Failed to load blog post');
        }

        const blog = await response.json();

        // Check if user can edit this blog
        const isAuthor = currentUser.id === blog.author_id;
        const isModerator = currentUser.roles.includes('admin') || currentUser.roles.includes('moderator');

        if (!isAuthor && !isModerator) {
            showError('You do not have permission to edit this blog post.');
            return;
        }

        // Populate form with existing data
        document.getElementById('blog-title').value = blog.title || '';
        document.getElementById('blog-body').value = blog.body || '';
        document.getElementById('allow-comments').checked = blog.allow_comments !== false;

        showEditForm();

    } catch (error) {
        console.error('Error loading blog for edit:', error);
        showError('Failed to load blog post for editing.');
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
        window.location.href = `/blogs/view/${blogId}`;
    } else {
        window.location.href = '/blogs';
    }
}

// Handle form submission
document.getElementById('blog-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = document.getElementById('blog-title').value.trim();
    const body = document.getElementById('blog-body').value.trim();
    const allowComments = document.getElementById('allow-comments').checked;

    if (!title || !body) {
        alert('Please fill in both title and content fields.');
        return;
    }

    const saveButton = document.querySelector('.btn-save');
    const originalText = saveButton.textContent;
    saveButton.textContent = 'Saving...';
    saveButton.disabled = true;

    try {
        const blogData = {
            type: 'blog',
            title: title,
            body: body,
            allow_comments: allowComments,
            status: 'published'
        };

        let response;
        if (isEditMode) {
            // Update existing blog
            response = await fetch(`/api/content/${blogId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(blogData)
            });
        } else {
            // Create new blog
            response = await fetch('/api/content', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(blogData)
            });
        }

        if (response.ok) {
            const result = await response.json();
            const resultId = result._id || result.id || blogId;

            alert(isEditMode ? 'Blog updated successfully!' : 'Blog created successfully!');
            window.location.href = `/blogs/view/${resultId}`;
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save blog');
        }

    } catch (error) {
        console.error('Error saving blog:', error);
        alert(`Failed to ${isEditMode ? 'update' : 'create'} blog: ${error.message}`);

        saveButton.textContent = originalText;
        saveButton.disabled = false;
    }
});

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    initializeMode();
    await checkAuth();
});