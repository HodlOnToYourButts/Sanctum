// Shared voting utilities

// Track user votes locally for undo functionality
let userVotes = {};

async function vote(contentId, voteType) {
    if (!currentUser) {
        alert('Please login to vote');
        return;
    }

    try {
        const currentVote = userVotes[contentId];
        const actualVote = (currentVote === voteType) ? 'remove' : voteType;

        const response = await fetch(`/api/content/${contentId}/vote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ vote: actualVote })
        });

        if (!response.ok) {
            throw new Error('Failed to vote');
        }

        const result = await response.json();

        if (actualVote === 'remove') {
            delete userVotes[contentId];
        } else {
            userVotes[contentId] = actualVote;
        }

        return result;
    } catch (error) {
        console.error('Voting error:', error);
        alert('Failed to vote. Please try again.');
        throw error;
    }
}

function getUserVote(contentId) {
    return userVotes[contentId] || null;
}

// Utility to update vote display
function updateVoteDisplay(contentId, votes) {
    const scoreElement = document.querySelector(`[data-content-id="${contentId}"] .vote-score`);
    if (scoreElement) {
        scoreElement.textContent = votes.score;
    }
}

// Initialize vote buttons for a content item
function initializeVoteButtons(contentId, currentVotes) {
    const voteContainer = document.querySelector(`[data-content-id="${contentId}"] .vote-container`);
    if (!voteContainer) return;

    const userVote = getUserVote(contentId);

    const upButton = voteContainer.querySelector('.vote-up');
    const downButton = voteContainer.querySelector('.vote-down');

    if (upButton) {
        upButton.classList.toggle('active', userVote === 'up');
        upButton.onclick = () => handleVote(contentId, 'up');
    }

    if (downButton) {
        downButton.classList.toggle('active', userVote === 'down');
        downButton.onclick = () => handleVote(contentId, 'down');
    }
}

async function handleVote(contentId, direction) {
    try {
        const result = await vote(contentId, direction);
        updateVoteDisplay(contentId, result.votes);
        initializeVoteButtons(contentId, result.votes);
    } catch (error) {
        // Error already handled in vote function
    }
}