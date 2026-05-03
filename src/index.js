const YouTubePlugin = {
    async onInit(api) {
      api.log("[YouTubePlugin] Initializing...");

      let uid = null;
      let currentRoomCode = null;
      let disposing = false;
      let disconnectOnLeave = true;
      let _titleDebounce = null;

      try {
        if (api.settings?.get) {
          disconnectOnLeave = (await api.settings.get("disconnectOnLeave", true)) === true;
          uid = (await api.settings.get("youtubeUserId", null)) || null;
        }
      } catch (e) {
        api.log("[YouTubePlugin] Failed to read settings (non-fatal):", e);
      }

      let disposeSetting = null;
      try {
        if (api.settings?.onChange) {
          disposeSetting = api.settings.onChange(({ key, value }) => {
            if (key === "disconnectOnLeave") {
              disconnectOnLeave = value === true;
              api.log(`[YouTubePlugin] disconnectOnLeave=${disconnectOnLeave}`);
            }
            if (key === "youtubeUserId" && value) {
              uid = value;
              api.log("[YouTubePlugin] youtubeUserId updated");
            }
          });
        }
      } catch (e) {
        api.log("[YouTubePlugin] Failed to subscribe to settings changes (non-fatal):", e);
      }

      function getVideoId(url) {
        try {
          const u = new URL(url);
          if (
            (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") &&
            u.pathname === "/watch"
          ) {
            return u.searchParams.get("v") || null;
          }
        } catch (_) {}
        return null;
      }

      function cleanTitle(raw) {
        return (raw || "")
          .replace(/\s*[-–—]\s*YouTube\s*$/i, "")
          .trim();
      }

      function emitDisconnectIfConnected(reason) {
        if (disposing) return;
        if (!currentRoomCode) return;
        const roomCode = currentRoomCode;
        currentRoomCode = null;
        api.log(`[YouTubePlugin] disconnect(${roomCode}) reason=${reason}`);
        api.sendEvent("disconnect", roomCode, null);
      }

      const onNavigated = ({ url }) => {
        if (disposing) return;
        const videoId = getVideoId(url);

        if (videoId) {
          if (currentRoomCode === videoId) return;
          if (currentRoomCode) {
            api.log(`[YouTubePlugin] Switching videos: disconnecting ${currentRoomCode} before connecting ${videoId}`);
            api.sendEvent("disconnect", currentRoomCode, null);
          }
          currentRoomCode = videoId;
          // No title yet — TitleChanged will follow and update the label
          api.sendEvent("connect", videoId, null, null);
        } else if (currentRoomCode) {
          if (!disconnectOnLeave) {
            api.log("[YouTubePlugin] Left video page; disconnectOnLeave=false, staying connected.");
            return;
          }
          emitDisconnectIfConnected("navigated-away");
        }
      };

      const onTitleChanged = ({ title, url }) => {
        if (disposing) return;
        const videoId = getVideoId(url);
        if (!videoId || videoId !== currentRoomCode) return;

        const label = cleanTitle(title);
        if (!label) return;

        // Debounce: YouTube sets the title multiple times during load
        clearTimeout(_titleDebounce);
        _titleDebounce = setTimeout(() => {
          if (disposing || videoId !== currentRoomCode) return;
          api.log(`[YouTubePlugin] title updated: "${label}"`);
          // Same roomCode → connectionHub treats this as a label-only update
          api.sendEvent("connect", videoId, null, label);
        }, 500);
      };

      const onWindowClosed = () => {
        emitDisconnectIfConnected("window-closed");
        api.stop();
      };

      await api.host.browser.subscribe({ events: ["Navigated", "TitleChanged", "WindowClosed"] });

      const disposeNavigated = api.on("browser:Navigated", onNavigated);
      const disposeTitleChanged = api.on("browser:TitleChanged", onTitleChanged);
      const disposeWindowClosed = api.on("browser:WindowClosed", onWindowClosed);

      await api.host.browser.openWindow({ url: "https://www.youtube.com", title: "YouTube – Saltshaker" });
      api.log("[YouTubePlugin] YouTube window opened.");

      this.onDispose = async () => {
        if (disposing) return;
        disposing = true;

        clearTimeout(_titleDebounce);

        if (currentRoomCode) {
          const roomCode = currentRoomCode;
          currentRoomCode = null;
          api.log(`[YouTubePlugin] Disposing: disconnect(${roomCode})`);
          api.sendEvent("disconnect", roomCode, null);
        }

        try { disposeNavigated(); } catch (e) { api.log("[YouTubePlugin] disposeNavigated error", e); }
        try { disposeTitleChanged(); } catch (e) { api.log("[YouTubePlugin] disposeTitleChanged error", e); }
        try { disposeWindowClosed(); } catch (e) { api.log("[YouTubePlugin] disposeWindowClosed error", e); }
        try { disposeSetting?.(); } catch (e) { api.log("[YouTubePlugin] disposeSetting error", e); }

        if (api.host?.browser?.unsubscribe) {
          try {
            await api.host.browser.unsubscribe({ events: ["Navigated", "TitleChanged", "WindowClosed"] });
          } catch (e) {
            api.log("[YouTubePlugin] browser.unsubscribe failed (non-fatal):", e);
          }
        }

        if (api.host?.browser?.closeWindow) {
          try {
            api.host.browser.closeWindow();
          } catch (e) {
            api.log("[YouTubePlugin] closeWindow failed (non-fatal):", e);
          }
        }

        api.log("[YouTubePlugin] Disposed.");
      };
    },

    async onDispose() {
      if (typeof this.onDispose === "function") return this.onDispose();
    }
  };

  module.exports = YouTubePlugin;
