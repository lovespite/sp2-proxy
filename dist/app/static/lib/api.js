(function () {
  const Api = {
    /**
     * @returns {Promise<number[]>}
     */
    getChannels: async function () {
      try {
        const ret = await http.get("/api/channels");
        return throwIfNotFulfilled(ret);
      } catch (e) {
        showError(e);
        return [];
      }
    },

    /**
     * @param {number?} cid
     * @returns {Promise<{token: string, cid: number}>}
     */
    openChannel: async function (cid) {
      try {
        const ret = cid
          ? await http.post("/api/channel", { cid })
          : await await http.post("/api/channel", {});
        return throwIfNotFulfilled(ret);
      } catch (e) {
        showError(e);
      }
    },
    deleteChannel: async function (cid, token) {
      try {
        const ret = await http.delete(`/api/channel/${cid}?token=${token}`);
        console.log(ret);
        return !!ret.success;
      } catch (e) {
        showError(e);
        return false;
      }
    },
    /**
     * @param {number} cid
     * @param {string} token
     * @param {string} content
     */
    sendMessage: async function (cid, token, content) {
      try {
        const ret = await http.post(`/api/message`, {
          type: 0, // text
          token,
          content,
          cid,
          mineType: "text/plain",
        });

        throwIfNotFulfilled(ret);
      } catch (e) {
        showError(e);
      }
    },

    /**
     * @param {number} cid
     * @param {string} token
     * @param {ArrayBuffer} content
     * @param {name} name
     */
    sendImage: async function (cid, token, content, name) {
      try {
        name = encodeURIComponent(name);
        const ret = await http.raw(
          `/raw/image/${cid}?token=${token}&name=${name}`,
          content
        );

        throwIfNotFulfilled(ret);
      } catch (e) {
        showError(e);
      }
    },

    /**
     * @param {number} cid
     * @param {string} token
     * @param {ArrayBuffer} content
     * @param {name} name
     */
    sendFile: async function (cid, token, content, name) {
      try {
        name = encodeURIComponent(name);
        const ret = await http.raw(
          `/raw/file/${cid}?token=${token}&name=${name}`,
          content
        );

        throwIfNotFulfilled(ret);
      } catch (e) {
        showError(e);
      }
    },

    /**
     * @param {number} cid
     * @param {string} token
     * @param {string} command
     * @param {number?} shellChannel
     * @returns {Promise<{shellChannel: number}>}
     */
    sendShell: async function (cid, token, command, shellChannel) {
      try {
        const ret = await http.post(
          `/api/shell/${cid}?token=${token}&sid=${shellChannel || ""}`,
          {
            command,
          }
        );

        return throwIfNotFulfilled(ret);
      } catch (e) {
        showError(e);
        return null;
      }
    },

    /**
     * @param {number} cid
     * @param {string} token
     * @param {number} timeout
     * @param {AbortSignal} abortSignal
     * @returns
     */
    pullMessage: async function (cid, token, timeout, abortSignal) {
      try {
        timeout = timeout || 15000; // 15s
        const ret = await http.get(
          `/api/message/${cid}?token=${token}&timeout=${timeout}`,
          abortSignal
        );
        if (ret.data) return ret.data;
        return null; // no message yet
      } catch (e) {
        console.error(e);
      }
    },

    /**
     * @param {{
     * stopSignal: AbortSignal,
     * cid: number,
     * token: string,
     * callback: (message: string) => void
     * }}} param0
     * @returns
     */
    listenMessage: async function ({
      stopSignal,
      cid,
      token,
      callback,
      legacy = false,
    }) {
      if (typeof callback !== "function")
        throw new Error("callback is not a function");

      console.log(cid, "listenMessage started");

      if (legacy) {
        await this.useLongPolling(stopSignal, cid, token, callback);
      } else {
        await this.useSocketIo(stopSignal, cid, token, callback);
      }

      console.warn(cid, "listenMessage stopped");
    },

    useLongPolling: async function (stopSignal, cid, token, callback) {
      while (!stopSignal.aborted) {
        const ret = await this.pullMessage(cid, token, 15000, stopSignal); // 15s
        try {
          if (ret) callback(ret);
        } catch (e) {
          console.error(e);
        }

        if (stopSignal.aborted) break;
      }
    },

    useSocketIo: async function (stopSignal, cid, token, callback) {
      const socket = io({
        query: {
          cid,
          token,
        },
        reconnection: false,
      });

      socket.on("error", (msg) => {
        console.error(msg);
        stopSignal.abort();
        socket.close();
      });

      socket.on("data", (msg) => {
        callback(msg);
      });

      await new Promise((resolve) => {
        stopSignal.addEventListener("abort", () => {
          socket.close();
          resolve();
        });
      });
    },
  };

  window.Api = Api;
})();

function throwIfNotFulfilled(ret) {
  if (!ret.success) throw new Error(ret.message || "unknown error");
  return ret.data;
}
