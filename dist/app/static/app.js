const http = {
  post: async function (url, data) {
    const ret = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (ret.status !== 200) throw new Error(ret.statusText);

    return await ret.json();
  },

  get: async function (url, abortSignal) {
    const ret = await fetch(url, {
      signal: abortSignal,
    });

    if (ret.status !== 200) throw new Error(ret.statusText);

    return await ret.json();
  },

  delete: async function (url) {
    const ret = await fetch(url, {
      method: "DELETE",
    });

    if (ret.status !== 200) throw new Error(ret.statusText);

    return await ret.json();
  },
};

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
  sendMessage: async function (cid, token, content, type = 0) {
    try {
      const ret = await http.post(`/api/message`, {
        type, // text
        token,
        content,
        cid,
      });

      throwIfNotFulfilled(ret);
    } catch (e) {
      showError(e);
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
  listenMessage: async function ({ stopSignal, cid, token, callback }) {
    if (typeof callback !== "function")
      throw new Error("callback is not a function");

    console.log(cid, "listenMessage started");

    while (!stopSignal.aborted) {
      const ret = await this.pullMessage(cid, token, 15000, stopSignal); // 15s
      try {
        if (ret) callback(ret);
      } catch (e) {
        console.error(e);
      }

      if (stopSignal.aborted) break;
    }

    console.warn(cid, "listenMessage stopped");
  },
};

const maxChannelCount = 20;

function showError(e) {
  console.error(e);

  if (
    e instanceof DOMException &&
    (e.message.includes("aborted") || e.message.includes("终止"))
  )
    // aborted by user, ignore
    return;

  alert(e.message || `${e}`);
}

function throwIfNotFulfilled(ret) {
  if (!ret.success) throw new Error(ret.message || "unknown error");
  return ret.data;
}

(function () {
  window.onload = async function () {
    await loadChannels();
    document.querySelector("#create").addEventListener("click", newChannel);
    document.querySelector("#open").addEventListener("click", openChannel);
    document.querySelector("#close").addEventListener("click", closeChannel);
    document.querySelector("#send").addEventListener("click", sendTextMessage);
    document.querySelector("#image").addEventListener("click", sendImage);
  };
})();

async function loadChannels(select) {
  const channels = new Set(await Api.getChannels());
  const elChannels = document.querySelector("#channels");
  elChannels.innerHTML = ""; // clear

  Array(maxChannelCount)
    .fill(0)
    .map((_, c) => {
      const cid = c + 1;
      const name = `频道${cid}` + (channels.has(cid) ? "" : " (空闲)");
      return buildChannelOption(cid, name, channels.has(cid));
    })
    .forEach((o) => elChannels.appendChild(o));

  if (select > maxChannelCount) {
    elChannels.appendChild(buildChannelOption(select, `频道${select}`));
  }

  if (select) elChannels.value = select;
}

function disableElements(disabled = true) {
  document.querySelectorAll("button").forEach((el) => (el.disabled = disabled));
  document.querySelectorAll("input").forEach((el) => (el.disabled = disabled));
  document.querySelectorAll("select").forEach((el) => (el.disabled = disabled));
}

async function newChannel() {
  if (window.current) return;

  disableElements();
  const ret = await Api.openChannel();
  disableElements(false);
  if (!ret) return;

  const el = document.querySelector("#channels");
  const buttonCreate = document.querySelector("#create");
  const buttonClose = document.querySelector("#close");

  await loadChannels(ret.cid);

  el.disabled = true;
  buttonCreate.disabled = true;
  buttonClose.disabled = false;

  startMessageLoop(ret, document.querySelector("#msg"));

  info(`频道${ret.cid}已创建, 令牌: ${ret.token}`);
}

async function openChannel() {
  if (window.current) return;

  const el = document.querySelector("#channels");
  const buttonOpen = document.querySelector("#open");
  const buttonClose = document.querySelector("#close");

  const cid = el.value;
  const channelId = parseInt(cid);
  if (!channelId) return;

  disableElements();
  const ret = await Api.openChannel(channelId);
  disableElements(false);
  if (!ret) return;

  startMessageLoop(ret, document.querySelector("#msg"));

  await loadChannels(ret.cid);

  info(`频道${ret.cid}已打开, 令牌: ${ret.token}`);

  el.disabled = true;
  buttonOpen.disabled = true;
  buttonClose.disabled = false;
}

async function sendTextMessage() {
  if (!window.current) return;

  const contentEL = document.querySelector("#content");
  const content = contentEL.value;

  console.log(content);
  if (!content) return;

  const { cid, token } = window.current;

  await Api.sendMessage(cid, token, content);

  pushMessageEl(
    { content, type: 0 },
    document.querySelector("#msg"),
    "my-message"
  );

  contentEL.value = "";
  contentEL.focus();
}

function selectImage(callback) {
  // 创建一个 input 元素用于选择文件
  var fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*"; // 限制只能选择图片

  // 当用户选择文件后触发的事件
  fileInput.onchange = function (e) {
    var file = e.target.files[0]; // 获取用户选择的第一个文件
    if (file) {
      // 可以在这里添加更多的处理，例如预览图片或上传图片
      callback(file); // 调用回调函数并传递所选文件
    }
  };

  fileInput.click(); // 触发文件选择对话框
}

async function sendImage() {
  if (!window.current) return;

  selectImage(onImageSelected);

  async function onImageSelected(file) {
    const dataUrl = await fileToDataURL(file);

    const { cid, token } = window.current;

    await Api.sendMessage(cid, token, dataUrl, 2);

    pushMessageEl(
      { content: dataUrl, type: 2 },
      document.querySelector("#msg"),
      "my-message"
    );
  }
}

async function closeChannel() {
  if (!window.current) return;

  const buttonOpen = document.querySelector("#open");
  const buttonClose = document.querySelector("#close");
  const buttonCreate = document.querySelector("#create");

  const { cid, token } = window.current;
  if (!token) return;

  disableElements();
  const result = await Api.deleteChannel(cid, token);
  disableElements(false);
  if (!result) return;

  stopMessageLoop();

  await loadChannels();

  info(`频道${cid}已关闭`);

  const el = document.querySelector("#channels");

  el.disabled = false;
  buttonOpen.disabled = false;
  buttonClose.disabled = true;
  buttonCreate.disabled = false;
}

function buildChannelOption(cid, name, disabled) {
  const option = document.createElement("option");
  option.value = cid;
  option.textContent = name;
  if (disabled) option.disabled = true;
  return option;
}

function info(msg) {
  const el = document.querySelector("#info");
  el.textContent = msg;
}

function startMessageLoop(ret, msgContainer) {
  const controller = new AbortController();

  window.current = {
    cid: ret.cid,
    token: ret.token,
    task: Api.listenMessage({
      stopSignal: controller.signal,
      cid: ret.cid,
      token: ret.token,
      callback: (message) => {
        pushMessageEl(message, msgContainer, "remote-message");
      },
    }),
    controller,
  };
}

function stopMessageLoop() {
  if (!window.current) return;
  const { controller, task, cid } = window.current;
  controller.abort();
  window.current = null;
  task.then((_) => console.log(cid, "task stopped"));
}

function pushMessageEl(message, containerEl, className) {
  const { content, type } = message;
  const p = document.createElement("p");

  switch (type) {
    case 0: {
      //text
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        p.appendChild(document.createTextNode(line));
        if (index !== lines.length - 1)
          p.appendChild(document.createElement("br"));
      });

      break;
    }
    case 1: {
      // file
      const a = document.createElement("a");
      a.href = content;
      a.textContent = "下载文件";

      p.appendChild(a);

      break;
    }
    case 2: {
      //image
      const img = document.createElement("img");
      img.src = content;
      img.style.width = "100%";
      img.style.height = "auto";

      p.appendChild(img);

      break;
    }
  }
  if (className) p.className = className;
  containerEl.appendChild(p);
  containerEl.parentElement.scrollTo({
    top: containerEl.parentElement.scrollHeight,
    behavior: "smooth",
  });
}

async function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
