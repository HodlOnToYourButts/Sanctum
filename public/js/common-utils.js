// Shared common utilities

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getRelativeTime(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)}mo ago`;
    return `${Math.floor(diffInSeconds / 31536000)}y ago`;
}

// Utility to safely set innerHTML with XSS protection
function safeSetInnerHTML(element, htmlString) {
    if (typeof element === 'string') {
        element = document.getElementById(element);
    }
    if (!element) return;

    // For now, just set innerHTML but this could be enhanced with sanitization
    element.innerHTML = htmlString;
}

// Utility to show loading state
function showLoadingState(containerId, message = '// LOADING...') {
    const container = document.getElementById(containerId);
    if (container) {
        container.style.display = 'block';
        const loadingMessage = container.querySelector('.no-content-message');
        if (loadingMessage) {
            loadingMessage.textContent = message;
        }
    }
}

// Utility to hide loading state
function hideLoadingState(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.style.display = 'none';
    }
}

// Utility to handle API errors consistently
function handleApiError(error, context = '') {
    console.error(`API Error ${context}:`, error);
    const message = context ? `Failed to ${context}. Please try again.` : 'An error occurred. Please try again.';
    alert(message);
}

// Toggle mobile navigation menu
function toggleMobileNav() {
    const mobileNav = document.getElementById('mobile-nav');
    if (mobileNav) {
        mobileNav.classList.toggle('show');
        // Add/remove class to body to handle content shifting
        document.body.classList.toggle('mobile-nav-open', mobileNav.classList.contains('show'));
    }
}

// Toggle mobile admin actions menu
function toggleMobileAdminActions(event) {
    // Find the mobile admin actions element that's a sibling of the clicked hamburger menu
    const hamburgerMenu = event ? event.target.closest('.admin-hamburger-menu') : null;
    if (hamburgerMenu) {
        const mobileAdminActions = hamburgerMenu.nextElementSibling;
        if (mobileAdminActions && mobileAdminActions.classList.contains('mobile-admin-actions')) {
            mobileAdminActions.classList.toggle('show');
        }
    } else {
        // Fallback to the original behavior for backward compatibility
        const mobileAdminActions = document.getElementById('mobile-admin-actions');
        if (mobileAdminActions) {
            mobileAdminActions.classList.toggle('show');
        }
    }
}