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
    document.getElementById('user-name').textContent = user.name || 'User';
    document.getElementById('user-email').textContent = user.email || '';
    document.getElementById('user-info').classList.add('show');

    let authButtons = '<button class="auth-button logout" onclick="logout()">Logout</button>';

    // Add admin link if user has admin role
    if (user.roles && user.roles.includes('admin')) {
        authButtons = '<a href="/admin" class="auth-button" style="margin-right: 0.5rem; text-decoration: none;">Admin</a>' + authButtons;
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

async function loadSiteSettings() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            document.querySelector('.logo').textContent = settings.name || 'Sanctum';
            document.querySelector('.subtitle').textContent = settings.description || 'Distributed Content Management System';
        }
    } catch (error) {
        console.error('Failed to load site settings:', error);
    }
}

// Check authentication status on page load
document.addEventListener('DOMContentLoaded', () => {
    loadSiteSettings();
    checkAuth();
});