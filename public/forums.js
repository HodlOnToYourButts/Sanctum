// Global state
let currentUser = null;

async function checkAuth() {
    try {
        const response = await fetch('/user');
        if (response.ok) {
            const user = await response.json();
            showLoggedInState(user);
        } else {
            showLoggedOutState();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        showLoggedOutState();
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

function showLoggedOutState() {
    document.getElementById('user-info').classList.remove('show');
    document.getElementById('auth-section').innerHTML =
        '<a href="/login" class="auth-button">Login / Sign Up</a>';
}

async function logout() {
    try {
        const response = await fetch('/logout', { method: 'POST' });
        if (response.ok) {
            showLoggedOutState();
        } else {
            console.error('Logout failed');
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
}

async function loadCategories() {
    try {
        // For now, display static categories. Later this can be made dynamic
        const categories = [
            {
                id: 'general',
                title: 'General Discussion',
                description: 'General topics and discussions about anything and everything.',
                icon: '💬',
                posts: 0,
                lastActivity: null
            },
            {
                id: 'announcements',
                title: 'Announcements',
                description: 'Important updates and announcements from the team.',
                icon: '📢',
                posts: 0,
                lastActivity: null
            },
            {
                id: 'support',
                title: 'Support',
                description: 'Get help with technical issues and questions.',
                icon: '🛠️',
                posts: 0,
                lastActivity: null
            },
            {
                id: 'feedback',
                title: 'Feedback',
                description: 'Share your thoughts and suggestions for improvements.',
                icon: '💡',
                posts: 0,
                lastActivity: null
            }
        ];

        // Get post counts for each category
        for (let category of categories) {
            try {
                const response = await fetch(`/api/content/feed?type=forum&category=${category.id}`);
                if (response.ok) {
                    const posts = await response.json();
                    category.posts = posts.length;
                    if (posts.length > 0) {
                        category.lastActivity = new Date(Math.max(...posts.map(p => new Date(p.created_at))));
                    }
                }
            } catch (error) {
                console.error(`Error loading posts for category ${category.id}:`, error);
            }
        }

        displayCategories(categories);
        document.getElementById('categories-loading').style.display = 'none';
    } catch (error) {
        console.error('Error loading categories:', error);
        document.getElementById('categories-loading').innerHTML =
            `<div class="error">Failed to load categories: ${error.message}</div>`;
    }
}

function displayCategories(categories) {
    const container = document.getElementById('categories-grid');

    if (categories.length === 0) {
        container.innerHTML = '<p class="loading">No categories found.</p>';
        return;
    }

    container.innerHTML = categories.map(category => `
        <div class="category-card" onclick="openCategory('${category.id}')">
            <div class="category-icon">${category.icon}</div>
            <div class="category-title">${escapeHtml(category.title)}</div>
            <div class="category-description">${escapeHtml(category.description)}</div>
            <div class="category-stats">
                <span>${category.posts} posts</span>
                <span>${category.lastActivity ?
                    'Last: ' + category.lastActivity.toLocaleDateString() :
                    'No activity yet'}</span>
            </div>
        </div>
    `).join('');
}

function openCategory(categoryId) {
    // For now, just show an alert. Later this can navigate to category page
    alert(`Opening category: ${categoryId}\n\nThis will be implemented to show forum posts in this category.`);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Check authentication status on page load
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadCategories();
});