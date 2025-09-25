// Shared authentication utilities
let currentUser = null;
let authCacheTime = 0;
const AUTH_CACHE_DURATION = 30000; // 30 seconds

async function checkAuth() {
    // Check cache first to avoid loading flicker
    const cachedAuth = getCachedAuth();
    if (cachedAuth) {
        if (cachedAuth.user) {
            await showLoggedInState(cachedAuth.user);
        } else {
            showLoggedOutState();
        }
        return;
    }

    // Hide the static loading element immediately
    hideStaticLoading();

    try {
        const response = await fetch('/user');
        if (response.ok) {
            const user = await response.json();
            setCachedAuth({ user });
            await showLoggedInState(user);
        } else if (response.status === 401) {
            setCachedAuth({ user: null });
            showLoggedOutState();
        } else {
            console.warn('Auth check returned unexpected status:', response.status);
            showLoggedOutState();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        showLoggedOutState();
    }
}

function getCachedAuth() {
    const now = Date.now();
    const cached = localStorage.getItem('auth_cache');
    if (cached && (now - authCacheTime) < AUTH_CACHE_DURATION) {
        try {
            return JSON.parse(cached);
        } catch (e) {
            localStorage.removeItem('auth_cache');
        }
    }
    return null;
}

function setCachedAuth(authData) {
    authCacheTime = Date.now();
    localStorage.setItem('auth_cache', JSON.stringify(authData));
}

function clearAuthCache() {
    authCacheTime = 0;
    localStorage.removeItem('auth_cache');
}

function hideStaticLoading() {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
        loadingElement.style.display = 'none';
    }
}

async function showLoggedInState(user) {
    currentUser = user;
    document.getElementById('user-name-header').textContent = user.name || 'User';
    document.getElementById('user-info').classList.add('show');

    const authButtons = await generateAuthButtons();
    document.getElementById('auth-section').innerHTML = authButtons;
}

function showLoggedOutState() {
    currentUser = null;
    document.getElementById('user-info').classList.remove('show');
    document.getElementById('auth-section').innerHTML =
        '<button class="auth-button" onclick="goToLogin()">Login</button>';
}

function goToLogin() {
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.href = `/login?return=${returnUrl}`;
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
                clearAuthCache();
                showLoggedOutState();
                // Optionally redirect to OIDC logout URL for complete logout
                if (result.logoutUrl) {
                    window.location.href = result.logoutUrl;
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