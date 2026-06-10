import { escapeHTML } from '/js/app/utils.js';

export const UI = {
  renderDocumentList(container, documents, currentDocId, onOpen, onDelete, currentUserId) {
    if (!documents || documents.length === 0) {
      container.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; padding: 40px; color: #b0b0b0;">
                        No documents yet. Create your first document!
                    </td>
                </tr>
            `;
      return;
    }

    container.innerHTML = documents
      .map((doc) => {
        const isActive = doc._id === currentDocId;
        const date = new Date(doc.lastModified);
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();

        let dateStr;
        if (isToday) {
          dateStr = `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } else {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          if (date.toDateString() === yesterday.toDateString()) {
            dateStr = `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          } else {
            dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
          }
        }

        const previewText =
          doc.pages && doc.pages[0] && doc.pages[0].content
            ? escapeHTML(
                typeof doc.pages[0].content === 'string'
                  ? doc.pages[0].content.substring(0, 100)
                  : 'Document content'
              )
            : 'Empty document';

        const location = doc.owner === currentUserId ? 'My Drive' : 'Shared with me';
        const safeTitle = escapeHTML(doc.title);

        return `
                <tr class="doc-item" data-doc-id="${doc._id}">
                    <td style="padding: 16px 24px;">
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div class="doc-icon-container">
                                <i class="fas fa-file-alt"></i>
                            </div>
                            <div>
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                    <div class="doc-title-text">${safeTitle}</div>
                                </div>
                                <div class="doc-meta-text" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 400px;">${previewText}</div>
                            </div>
                        </div>
                    </td>
                    <td class="doc-meta-text" style="padding: 16px 24px; font-size: 14px;">${location}</td>
                    <td class="doc-meta-text" style="padding: 16px 24px; font-size: 14px;">${dateStr}</td>
                    <td style="padding: 16px 24px; text-align: center;">
                        <button class="delete-doc-btn" data-doc-id="${doc._id}" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
      })
      .join('');

    container.onclick = (e) => {
      const deleteBtn = e.target.closest('.delete-doc-btn');
      const docItem = e.target.closest('.doc-item');

      if (deleteBtn) {
        e.stopPropagation();
        onDelete(deleteBtn.dataset.docId);
        return;
      }

      if (docItem) {
        onOpen(docItem.dataset.docId);
      }
    };
  },

  updateCollaboratorsUI(container, users, currentUsername) {
    if (!container) return;
    const otherUsers = users.filter((user) => user.username !== currentUsername);
    container.style.display = otherUsers.length > 0 ? 'flex' : 'none';

    container.innerHTML = otherUsers
      .map((user, index) => {
        const colors = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#6366f1', '#818cf8', '#a5b4fc'];
        const color = colors[index % colors.length];
        const initial = escapeHTML(user.username.charAt(0).toUpperCase());
        const safeUsername = escapeHTML(user.username);

        if (user.profilePicture) {
          return `
                <div title="${safeUsername}" style="width: 30px; height: 30px; border-radius: 50%; background: #ffffff; border: 2px solid var(--accent-color); margin-left: -8px; cursor: default; box-shadow: 0 0 15px rgba(var(--accent-color-rgb), 0.4); overflow: hidden; position: relative;">
                    <img src="${user.profilePicture}" style="width: 100%; height: 100%; object-fit: cover;" alt="${initial}">
                </div>`;
        }

        return `
                <div title="${safeUsername}" style="width: 30px; height: 30px; border-radius: 50%; background: ${color}; color: white; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: bold; border: 2px solid #0a0a0a; margin-left: -8px; cursor: default; box-shadow: 0 0 15px rgba(var(--accent-color-rgb), 0.4);">
                    ${initial}
                </div>`;
      })
      .join('');
  },

  updateConnectionStatus(container, status) {
    if (!container) return;

    const titleEl = container.querySelector('#overlayTitle');
    const descEl = container.querySelector('#overlayDesc');

    if (status === 'connected') {
      container.style.display = 'none';
    } else if (status === 'connecting') {
      container.style.display = 'flex';
      if (titleEl) titleEl.textContent = 'Connecting...';
      if (descEl) descEl.textContent = 'Establishing connection to the real-time server...';
    } else if (status === 'reconnecting' || status === 'disconnected') {
      container.style.display = 'flex';
      if (titleEl) titleEl.textContent = 'Connection Lost';
      if (descEl)
        descEl.textContent = 'We are attempting to reconnect you to the document. Please wait...';
    } else if (status === 'offline') {
      container.style.display = 'flex';
      if (titleEl) titleEl.textContent = 'Server Offline';
      if (descEl)
        descEl.textContent = 'The server is currently unavailable. We will keep trying to connect.';
    }
  },
};
