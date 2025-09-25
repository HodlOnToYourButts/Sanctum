// Utility functions for user profile management

/**
 * Get the SSO site URL from the ISSUER environment variable
 * Converts sso.domain.com to domain.com for self-service access
 */
async function getSSOSiteUrl() {
    try {
        const response = await fetch('/debug/oauth');
        if (response.ok) {
            const config = await response.json();

            if (config.issuer && config.issuer !== 'NOT_SET') {
                const url = new URL(config.issuer);
                const hostname = url.hostname;

                // Handle localhost development setup
                if (hostname === 'localhost' || hostname === '127.0.0.1') {
                    // For localhost:8080 SSO, assume UI is on port 18080
                    if (url.port === '8080') {
                        return `${url.protocol}//${hostname}:18080`;
                    }
                    return null;
                }

                // Remove 'sso.' prefix if present for production domains
                const mainDomain = hostname.startsWith('sso.')
                    ? hostname.substring(4)
                    : hostname;

                return `${url.protocol}//${mainDomain}`;
            }
        }
    } catch (error) {
        console.error('Failed to get SSO site URL:', error);
    }
    return null;
}

/**
 * Get favicon URL for the SSO site
 */
async function getSSOFaviconUrl() {
    const ssoSiteUrl = await getSSOSiteUrl();
    if (ssoSiteUrl) {
        // Skip favicon for localhost to avoid CORS issues
        const url = new URL(ssoSiteUrl);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
            return null;
        }
        return `${ssoSiteUrl}/favicon.svg`;
    }
    return null;
}

/**
 * Create profile button with SSO site favicon
 */
async function createProfileButton() {
    const ssoSiteUrl = await getSSOSiteUrl();
    const faviconUrl = await getSSOFaviconUrl();

    if (ssoSiteUrl) {
        const iconHtml = faviconUrl
            ? `<img src="${faviconUrl}" alt="Profile" class="profile-icon" crossorigin="anonymous" onerror="this.style.display='none';this.nextElementSibling.style.display='inline';">
               <span class="profile-icon-fallback" style="display:none;">👤</span>`
            : `<span class="profile-icon-fallback">👤</span>`;

        return `<button class="auth-button profile" onclick="openProfilePage('${ssoSiteUrl}')" title="Manage Account">
            ${iconHtml}
        </button>`;
    }
    return '';
}

/**
 * Open the SSO self-service page
 */
function openProfilePage(ssoSiteUrl) {
    console.log('Opening profile page:', ssoSiteUrl);
    window.open(ssoSiteUrl, '_blank');
}

/**
 * Generate auth buttons with profile button
 */
async function generateAuthButtons() {
    const profileButton = await createProfileButton();
    const logoutButton = '<button class="auth-button logout" onclick="logout()">Logout</button>';

    return profileButton + logoutButton;
}