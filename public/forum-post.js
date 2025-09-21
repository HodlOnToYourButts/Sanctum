// Global state
// currentUser is now defined in auth-utils.js
let currentPost = null;
let postId = null;

// Category mappings for display names and slugs
const categoryMappings = {
    'general-discussion': { name: 'General Discussion', slug: 'general-discussion' },
    'announcements': { name: 'Announcements', slug: 'announcements' },
    'support': { name: 'Support', slug: 'support' },
    'feedback': { name: 'Feedback', slug: 'feedback' }
};

function getCategoryDisplayName(categorySlug) {
    return categoryMappings[categorySlug]?.name || categorySlug;
}

function getCategorySlug(categorySlug) {
    return categoryMappings[categorySlug]?.slug || categorySlug;
}

// Get post ID from URL
function getPostId() {
    const pathParts = window.location.pathname.split('/');
    return pathParts[pathParts.length - 1];
}

async function checkAuth() {
    try {
        const response = await fetch('/user');
        if (response.ok) {
            const user = await response.json();
            showLoggedInState(user);
        } else if (response.status === 401) {
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

function showLoggedInState(user) {
    currentUser = user;
    document.getElementById('user-name-header').textContent = user.name || 'User';
    document.getElementById('user-info').classList.add('show');

    let authButtons = '<button class="auth-button logout" onclick="logout()">Logout</button>';

    document.getElementById('auth-section').innerHTML = authButtons;

    // Clear any login prompts that might be showing
    const loginPrompts = document.querySelectorAll('.login-prompt');
    loginPrompts.forEach(prompt => prompt.remove());

    // Update comment form if user is logged in
    updateCommentForm();
    updateAdminActions();
}

function showLoggedOutState() {
    currentUser = null;
    document.getElementById('user-info').classList.remove('show');
    document.getElementById('auth-section').innerHTML =
        '<button class="auth-button" onclick="goToLogin()">Login</button>';

    updateCommentForm();
    updateAdminActions();
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
                showLoggedOutState();
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

async function loadPost() {
    try {
        const response = await fetch(`/api/content/${postId}`);
        if (!response.ok) {
            if (response.status === 404) {
                showError('Forum post not found.');
                return;
            }
            throw new Error('Failed to load forum post');
        }

        currentPost = await response.json();
        displayPost();

        loadReplies();

        document.getElementById('loading-container').style.display = 'none';
        document.getElementById('post-container').style.display = 'block';
    } catch (error) {
        console.error('Error loading post:', error);
        showError('Failed to load forum post.');
    }
}

function displayPost() {
    // Update page titles
    document.title = `${currentPost.title} | Sanctum`;
    document.getElementById('post-title').textContent = `${currentPost.title} | Sanctum`;

    // Update post header with clickable category
    const categorySlug = currentPost.category || 'general-discussion';
    const categoryName = getCategoryDisplayName(categorySlug);
    const categoryLink = `/forums/category/${getCategorySlug(categorySlug)}`;

    const categoryElement = document.getElementById('post-category-header');
    categoryElement.textContent = categoryName;
    categoryElement.href = categoryLink;

    // Add featured badge to title if featured
    const titleElement = document.getElementById('post-title-text');
    if (currentPost.featured) {
        titleElement.innerHTML = `${escapeHtml(currentPost.title)}<span class="featured-badge">★</span>`;
    } else {
        titleElement.textContent = currentPost.title;
    }

    // Update author info
    const authorName = currentPost.author?.name || 'Unknown';
    document.getElementById('author-name').textContent = authorName;

    // Set author role based on user roles - check multiple sources
    let authorRoles = currentPost.author?.roles || currentPost.author_roles || [];

    // Fallback: if no roles found and current user is the author, use current user's roles
    if (authorRoles.length === 0 && currentUser && currentPost.author?.id === currentUser.id) {
        authorRoles = currentUser.roles || [];
        console.log('Using current user roles as fallback:', authorRoles);
    }
    let roleDisplay = 'Member';
    if (authorRoles.includes('admin')) {
        roleDisplay = 'Administrator';
    } else if (authorRoles.includes('moderator')) {
        roleDisplay = 'Moderator';
    } else if (authorRoles.includes('contributor')) {
        roleDisplay = 'Contributor';
    }
    document.getElementById('author-role').textContent = roleDisplay;

    // Set author stats
    document.getElementById('author-joined').textContent = new Date(currentPost.created_at).toLocaleDateString();

    // Load author post count
    loadAuthorStats(authorName);

    // Update post meta
    document.getElementById('post-date').textContent = new Date(currentPost.created_at).toLocaleString();

    // Update post content
    document.getElementById('post-content').innerHTML = formatPostContent(currentPost.body);

    // Reply count removed - now showing actions instead

    // Update voting
    updateVoting();

    // Update comment form visibility
    updateCommentForm();

    // Update admin actions now that post is loaded
    updateAdminActions();
}

function formatPostContent(content) {
    return content.replace(/\n/g, '<br>');
}

function updateVoting() {
    if (!currentPost.votes) {
        currentPost.votes = { up: 0, down: 0, score: 0 };
    }

    document.getElementById('upvote-count').textContent = currentPost.votes.up;
    document.getElementById('downvote-count').textContent = currentPost.votes.down;
    document.getElementById('vote-score').textContent = currentPost.votes.score;

    // Keep vote score white always (removed dynamic coloring)

    // Update button states if user is logged in
    if (currentUser) {
        const upBtn = document.getElementById('upvote-btn');
        const downBtn = document.getElementById('downvote-btn');

        upBtn.disabled = false;
        downBtn.disabled = false;

        // Check if current user has voted and update button appearance
        const userVote = currentPost.voter_list?.find(vote => vote.user_id === currentUser.id);

        // Remove existing voted classes
        upBtn.classList.remove('voted');
        downBtn.classList.remove('voted');

        // Add voted class to the appropriate button
        if (userVote) {
            if (userVote.type === 'up') {
                upBtn.classList.add('voted');
            } else if (userVote.type === 'down') {
                downBtn.classList.add('voted');
            }
        }
    } else {
        document.getElementById('upvote-btn').disabled = true;
        document.getElementById('downvote-btn').disabled = true;
    }
}

async function votePost(voteType) {
    if (!currentUser) {
        alert('Please login to vote');
        return;
    }

    // Check if user is clicking the same vote type they already voted for (toggle to cancel)
    const existingVote = currentPost.voter_list?.find(vote => vote.user_id === currentUser.id);
    let actualVoteType = voteType;

    if (existingVote && existingVote.type === voteType) {
        // User is clicking the same vote type - remove the vote
        actualVoteType = 'remove';
    }

    try {
        const response = await fetch(`/api/content/${postId}/vote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ vote: actualVoteType })
        });

        if (!response.ok) {
            throw new Error('Failed to vote');
        }

        const result = await response.json();
        currentPost.votes = result.votes;

        // Update voter_list to reflect current user's vote
        if (!currentPost.voter_list) {
            currentPost.voter_list = [];
        }

        // Remove any existing vote by this user
        currentPost.voter_list = currentPost.voter_list.filter(vote => vote.user_id !== currentUser.id);

        // Add the new vote (only if not removing)
        if (actualVoteType !== 'remove') {
            currentPost.voter_list.push({
                user_id: currentUser.id,
                type: actualVoteType,
                timestamp: new Date().toISOString()
            });
        }

        updateVoting();
    } catch (error) {
        console.error('Voting error:', error);
        alert('Failed to vote. Please try again.');
    }
}

function updateCommentForm() {
    const commentForm = document.getElementById('comment-form');
    const commentsSection = document.getElementById('comments-section');

    if (currentPost) {
        commentsSection.style.display = 'block';
        if (currentUser) {
            commentForm.style.display = 'block';
            // Clear any login prompts when user is logged in
            const loginPrompts = document.querySelectorAll('.login-prompt');
            loginPrompts.forEach(prompt => prompt.remove());
        } else {
            commentForm.style.display = 'none';
            // Show login prompt for non-logged in users
            const commentFormContainer = commentForm.parentElement;
            if (commentFormContainer && !commentFormContainer.querySelector('.login-prompt')) {
                const loginPrompt = document.createElement('div');
                loginPrompt.className = 'login-prompt';
                loginPrompt.innerHTML = `
                    <div class="login-prompt-content">
                        <p>You must be logged in to reply to this post.</p>
                        <button class="auth-button" onclick="goToLogin()">Login</button>
                    </div>
                `;
                commentFormContainer.insertBefore(loginPrompt, commentForm);
            }
        }
    } else {
        commentsSection.style.display = 'none';
    }
}

function updateAdminActions() {
    const actionsContainer = document.getElementById('post-actions');
    const repliesHeader = document.querySelector('.replies-header');

    if (!actionsContainer) {
        console.warn('post-actions element not found');
        return;
    }

    let actions = '';

    if (currentUser && currentPost) {
        console.log('Updating admin actions for user:', currentUser.name, 'with roles:', currentUser.roles);
        const isAuthor = currentUser.id === currentPost.author?.id;
        const isModerator = currentUser.roles && (currentUser.roles.includes('admin') || currentUser.roles.includes('moderator'));

        console.log('isAuthor:', isAuthor, 'isModerator:', isModerator);

        // PIN/UNPIN and PROMOTE/DEMOTE buttons moved to main admin action bar

        // Enable/Disable button moved to edit action area
    } else {
        console.log('No currentUser or currentPost:', !!currentUser, !!currentPost);
    }

    console.log('Setting actions HTML:', actions);
    actionsContainer.innerHTML = actions;

    // Hide/show the entire replies header based on whether there are any actions
    if (repliesHeader) {
        if (actions.trim() === '') {
            repliesHeader.style.display = 'none';
        } else {
            repliesHeader.style.display = 'flex';
        }
    }

    // Update edit action separately
    updateEditAction();
}

function updateEditAction() {
    const editContainer = document.getElementById('admin-actions');

    if (!editContainer) {
        console.warn('admin-actions element not found');
        return;
    }

    let editAction = '';

    if (currentUser && currentPost) {
        const isAuthor = currentUser.id === currentPost.author?.id;
        const isModerator = currentUser.roles && (currentUser.roles.includes('admin') || currentUser.roles.includes('moderator'));

        if (isAuthor || isModerator) {
            let actionsHtml = '';

            // Build action buttons
            actionsHtml += '<button class="admin-btn admin-btn-nav admin-btn-edit" onclick="editPost()">Edit</button>';

            // Add Disable/Enable button next to Edit
            // Authors can only disable, admins/moderators can enable/disable
            if (currentPost.enabled !== false) {
                actionsHtml += '<button class="admin-btn admin-btn-action admin-btn-disable" onclick="togglePostEnabled(false)">DISABLE</button>';
            } else if (isModerator) {
                // Only moderators can enable disabled posts
                actionsHtml += '<button class="admin-btn admin-btn-action" onclick="togglePostEnabled(true)">ENABLE</button>';
            }

            // Add moderator-only buttons (PROMOTE/DEMOTE and PIN/UNPIN)
            if (isModerator) {
                // Promote/Demote button
                if (currentPost.featured) {
                    actionsHtml += '<button class="admin-btn admin-btn-action admin-btn-demote" onclick="demotePost()">DEMOTE</button>';
                } else {
                    actionsHtml += '<button class="admin-btn admin-btn-action" onclick="promotePost()">PROMOTE</button>';
                }

                // Pin/Unpin button
                if (currentPost.pinned) {
                    actionsHtml += '<button class="admin-btn admin-btn-action admin-btn-unpin" onclick="unpinPost()">UNPIN</button>';
                } else {
                    actionsHtml += '<button class="admin-btn admin-btn-action" onclick="pinPost()">PIN</button>';
                }
            }

            // Create structure with both desktop buttons and mobile hamburger menu
            editAction = `
                <div class="desktop-admin-actions">
                    ${actionsHtml}
                </div>
                <div class="admin-hamburger-menu" onclick="toggleMobileAdminActions(event)">
                    <div class="hamburger-line"></div>
                    <div class="hamburger-line"></div>
                    <div class="hamburger-line"></div>
                </div>
                <div class="mobile-admin-actions" id="mobile-admin-actions">
                    ${actionsHtml}
                </div>
            `;
        }
    }

    editContainer.innerHTML = editAction;
}

function generateReplyAdminActions(replyId, enabled, isModerator) {
    let actionsHtml = '';

    // Edit button
    actionsHtml += `<button class="admin-btn admin-btn-nav admin-btn-edit" onclick="editReply('${replyId}')">Edit</button>`;

    // Enable/Disable button
    if (enabled !== false) {
        actionsHtml += `<button class="admin-btn admin-btn-action admin-btn-disable" onclick="toggleReplyEnabled('${replyId}', false)">DISABLE</button>`;
    } else if (isModerator) {
        actionsHtml += `<button class="admin-btn admin-btn-action" onclick="toggleReplyEnabled('${replyId}', true)">ENABLE</button>`;
    }

    return `
        <div class="desktop-admin-actions">
            ${actionsHtml}
        </div>
        <div class="admin-hamburger-menu" onclick="toggleMobileAdminActions(event)">
            <div class="hamburger-line"></div>
            <div class="hamburger-line"></div>
            <div class="hamburger-line"></div>
        </div>
        <div class="mobile-admin-actions" id="mobile-admin-actions">
            ${actionsHtml}
        </div>
    `;
}

async function pinPost() {
    try {
        const response = await fetch(`/api/content/${postId}/pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            alert('Post pinned successfully!');
            currentPost.pinned = true;
            updateAdminActions();
        } else {
            const error = await response.json();
            alert(`Failed to pin post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error pinning post:', error);
        alert('Failed to pin post. Please try again.');
    }
}

async function unpinPost() {
    try {
        const response = await fetch(`/api/content/${postId}/unpin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            alert('Post unpinned successfully!');
            currentPost.pinned = false;
            updateAdminActions();
        } else {
            const error = await response.json();
            alert(`Failed to unpin post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error unpinning post:', error);
        alert('Failed to unpin post. Please try again.');
    }
}

async function promotePost() {
    try {
        const response = await fetch(`/api/content/${postId}/promote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            alert('Post promoted to front page successfully!');
            currentPost.featured = true;
            updateAdminActions();
        } else {
            const error = await response.json();
            alert(`Failed to promote post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error promoting post:', error);
        alert('Failed to promote post. Please try again.');
    }
}

async function demotePost() {
    try {
        const response = await fetch(`/api/content/${postId}/demote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            alert('Post removed from front page successfully!');
            currentPost.featured = false;
            updateAdminActions();
        } else {
            const error = await response.json();
            alert(`Failed to demote post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error demoting post:', error);
        alert('Failed to demote post. Please try again.');
    }
}

function editPost() {
    window.location.href = `/forums/edit/${postId}`;
}

function editReply(replyId) {
    const replyElement = document.querySelector(`[data-reply-id="${replyId}"]`);
    if (!replyElement) return;

    const replyBody = replyElement.querySelector('.reply-body');
    const replyMetaBar = replyElement.querySelector('.reply-meta-bar');
    const originalContent = replyBody.textContent.trim();

    // Hide the meta bar (admin actions and date)
    if (replyMetaBar) {
        replyMetaBar.style.display = 'none';
    }

    // Replace reply body with textarea
    replyBody.innerHTML = `
        <div class="reply-edit-form">
            <textarea class="reply-edit-textarea" rows="4">${escapeHtml(originalContent)}</textarea>
            <div class="reply-edit-actions">
                <button class="btn-save" onclick="saveReplyEdit('${replyId}')">Save</button>
                <button class="btn-cancel" onclick="cancelReplyEdit('${replyId}', \`${escapeHtml(originalContent)}\`)">Cancel</button>
            </div>
        </div>
    `;

    // Focus the textarea
    const textarea = replyBody.querySelector('.reply-edit-textarea');
    textarea.focus();
}

function saveReplyEdit(replyId) {
    const replyElement = document.querySelector(`[data-reply-id="${replyId}"]`);
    const textarea = replyElement.querySelector('.reply-edit-textarea');
    const newContent = textarea.value.trim();

    if (!newContent) {
        alert('Reply content cannot be empty');
        return;
    }

    // Call API to update reply
    updateReplyContent(replyId, newContent);
}

function cancelReplyEdit(replyId, originalContent) {
    const replyElement = document.querySelector(`[data-reply-id="${replyId}"]`);
    const replyBody = replyElement.querySelector('.reply-body');
    const replyMetaBar = replyElement.querySelector('.reply-meta-bar');

    // Restore original content
    replyBody.innerHTML = formatPostContent(originalContent);

    // Show the meta bar again
    if (replyMetaBar) {
        replyMetaBar.style.display = '';
    }
}

async function updateReplyContent(replyId, newContent) {
    try {
        // First get the original reply data to preserve author information
        const repliesResponse = await fetch(`/api/content/${postId}/replies`);
        const replies = await repliesResponse.json();
        const originalReply = replies.find(r => r._id === replyId);

        if (!originalReply) {
            throw new Error('Reply not found');
        }

        const response = await fetch(`/api/content/replies/${replyId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: newContent,
                author_name: originalReply.author_name
            })
        });

        if (response.ok) {
            // Reload replies to show updated content
            await loadReplies();
        } else {
            const error = await response.json();
            alert(`Failed to update reply: ${error.error}`);
        }
    } catch (error) {
        console.error('Error updating reply:', error);
        alert('Failed to update reply. Please try again.');
    }
}

function backToForums() {
    window.location.href = '/forums';
}

async function loadReplies() {
    try {
        const response = await fetch(`/api/content/${postId}/replies`);
        if (!response.ok) {
            throw new Error('Failed to load replies');
        }

        const replies = await response.json();
        displayReplies(replies);
    } catch (error) {
        console.error('Error loading replies:', error);
        document.getElementById('comments-list').innerHTML =
            '<p class="error">Failed to load replies.</p>';
    }
}

function displayReplies(replies) {
    const commentsList = document.getElementById('comments-list');

    if (replies.length === 0) {
        commentsList.innerHTML = '<p class="no-replies-forum"></p>';
        return;
    }

    commentsList.innerHTML = replies.map((reply, index) => {
        const replyDate = new Date(reply.created_at);

        // Determine reply author role
        const replyAuthorRoles = reply.author_roles || [];
        let replyRoleDisplay = 'Member';
        if (replyAuthorRoles.includes('admin')) {
            replyRoleDisplay = 'Administrator';
        } else if (replyAuthorRoles.includes('moderator')) {
            replyRoleDisplay = 'Moderator';
        } else if (replyAuthorRoles.includes('contributor')) {
            replyRoleDisplay = 'Contributor';
        }

        // Check if current user can edit this reply
        const isReplyAuthor = currentUser && (currentUser.name === reply.author_name || currentUser.email === reply.author_email);
        const isModerator = currentUser && currentUser.roles && (currentUser.roles.includes('admin') || currentUser.roles.includes('moderator'));
        const canEditReply = isReplyAuthor || isModerator;

        return `
            <div class="forum-reply" data-reply-id="${reply._id}">
                <div class="reply-author-info">
                    <div class="reply-avatar">
                        <span class="avatar-placeholder">👤</span>
                    </div>
                    <div class="reply-author-details">
                        <div class="reply-author-name">${escapeHtml(reply.author_name)}</div>
                        <div class="reply-author-role">${replyRoleDisplay}</div>
                        <div class="reply-author-stats">
                            <div class="author-stat">
                                <span class="stat-label">Posts:</span>
                                <span class="stat-value" id="reply-author-posts-${index}">—</span>
                            </div>
                            <div class="author-stat">
                                <span class="stat-label">Joined:</span>
                                <span class="stat-value" id="reply-author-joined-${index}">—</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="reply-content">
                    <div class="reply-body">
                        ${formatPostContent(reply.content)}
                    </div>
                    <div class="reply-meta-bar">
                        <div class="reply-edit-action">
                            ${canEditReply ? generateReplyAdminActions(reply._id, reply.enabled, isModerator) : ''}
                        </div>
                        <div class="reply-date-info">
                            <span class="reply-date">${replyDate.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Load stats for each reply author
    replies.forEach((reply, index) => {
        loadReplyAuthorStats(reply.author_name, index);
    });
}

async function submitComment() {
    if (!currentUser) {
        alert('Please login to reply');
        return;
    }

    const textarea = document.getElementById('comment-text');
    const content = textarea.value.trim();

    if (!content) {
        alert('Please enter a reply');
        return;
    }

    try {
        const requestBody = {
            content: content,
            author_name: currentUser.name,
            author_roles: currentUser.roles || []
        };

        // Only add email if it's a valid email format
        if (currentUser.email && typeof currentUser.email === 'string' && currentUser.email.trim() && /\S+@\S+\.\S+/.test(currentUser.email)) {
            requestBody.author_email = currentUser.email;
        }

        console.log('Submitting reply with body:', requestBody);

        const response = await fetch(`/api/content/${postId}/replies`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            console.error('Comment submission failed:', response.status, errorData);
            throw new Error(errorData.error || `Failed to submit comment (${response.status})`);
        }

        textarea.value = '';
        await loadReplies();
        // Reload the post to update reply count
        await loadPost();
    } catch (error) {
        console.error('Error submitting reply:', error);
        alert('Failed to submit reply. Please try again.');
    }
}

async function loadAuthorStats(authorName) {
    try {
        const response = await fetch(`/api/content/user/${encodeURIComponent(authorName)}/stats`);
        if (response.ok) {
            const stats = await response.json();
            document.getElementById('author-posts').textContent = stats.forum_posts;
        } else {
            document.getElementById('author-posts').textContent = '—';
        }
    } catch (error) {
        console.error('Error loading author stats:', error);
        document.getElementById('author-posts').textContent = '—';
    }
}

async function loadReplyAuthorStats(authorName, index) {
    try {
        const response = await fetch(`/api/content/user/${encodeURIComponent(authorName)}/stats`);
        if (response.ok) {
            const stats = await response.json();

            // Update posts count
            const postsElement = document.getElementById(`reply-author-posts-${index}`);
            if (postsElement) {
                postsElement.textContent = stats.forum_posts;
            }

            // Update joined date
            const joinedElement = document.getElementById(`reply-author-joined-${index}`);
            if (joinedElement) {
                if (stats.join_date) {
                    joinedElement.textContent = new Date(stats.join_date).toLocaleDateString();
                } else {
                    joinedElement.textContent = '—';
                }
            }
        } else {
            // Set fallback values
            const postsElement = document.getElementById(`reply-author-posts-${index}`);
            if (postsElement) {
                postsElement.textContent = '—';
            }
            const joinedElement = document.getElementById(`reply-author-joined-${index}`);
            if (joinedElement) {
                joinedElement.textContent = '—';
            }
        }
    } catch (error) {
        console.error('Error loading reply author stats:', error);
        // Set fallback values
        const postsElement = document.getElementById(`reply-author-posts-${index}`);
        if (postsElement) {
            postsElement.textContent = '—';
        }
        const joinedElement = document.getElementById(`reply-author-joined-${index}`);
        if (joinedElement) {
            joinedElement.textContent = '—';
        }
    }
}

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

function showError(message) {
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('post-container').style.display = 'none';
    document.getElementById('error-message').textContent = message;
    document.getElementById('error-container').style.display = 'block';
}

async function togglePostEnabled(enable) {
    try {
        const response = await fetch(`/api/content/${postId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: currentPost.type,
                category: currentPost.category,
                title: currentPost.title,
                body: currentPost.body,
                enabled: enable
            })
        });

        if (response.ok) {
            alert(`Post ${enable ? 'enabled' : 'disabled'} successfully!`);
            currentPost.enabled = enable;
            updateAdminActions(); // Refresh admin actions
            displayPost(); // Refresh post display
        } else {
            const error = await response.json();
            alert(`Failed to ${enable ? 'enable' : 'disable'} post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error toggling post:', error);
        alert('Failed to update post setting. Please try again.');
    }
}

async function toggleReplyEnabled(replyId, enable) {
    try {
        // Get the current reply data first
        const replies = await (await fetch(`/api/content/${postId}/replies`)).json();
        const reply = replies.find(r => r._id === replyId);

        if (!reply) {
            alert('Reply not found');
            return;
        }

        const response = await fetch(`/api/content/replies/${replyId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: reply.content,
                author_name: reply.author_name,
                author_email: reply.author_email,
                author_roles: reply.author_roles || [],
                enabled: enable
            })
        });

        if (response.ok) {
            alert(`Reply ${enable ? 'enabled' : 'disabled'} successfully!`);
            await loadReplies(); // Refresh replies
        } else {
            const error = await response.json();
            alert(`Failed to ${enable ? 'enable' : 'disable'} reply: ${error.error}`);
        }
    } catch (error) {
        console.error('Error toggling reply:', error);
        alert('Failed to update reply setting. Please try again.');
    }
}

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    postId = getPostId();
    if (!postId) {
        showError('Invalid forum post URL.');
        return;
    }

    await checkAuth();
    await loadPost();
});