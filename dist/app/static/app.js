const maxChannelCount = 20;

const ctls = {
  slChannels: null,
  btnReload: null,

  btnOpen: null,
  btnCreate: null,
  btnClose: null,

  btnSend: null,
  btnImage: null,
  btnFile: null,
  btnShell: null,

  txtContent: null,

  sysinfo: null,
};

function loadCtls() {
  ctls.slChannels = document.querySelector("#channels");

  ctls.btnReload = document.querySelector("#reload");
  ctls.btnOpen = document.querySelector("#open");
  ctls.btnCreate = document.querySelector("#create");
  ctls.btnClose = document.querySelector("#close");

  ctls.btnSend = document.querySelector("#send");
  ctls.btnImage = document.querySelector("#image");
  ctls.btnFile = document.querySelector("#file");
  ctls.btnShell = document.querySelector("#shell");

  ctls.txtContent = document.querySelector("#content");
  ctls.sysinfo = document.querySelector("#system-info");
}

(function () {
  window.onload = async function () {
    loadCtls();

    await loadChannels();

    ctls.btnReload.addEventListener("click", reload);
    ctls.btnOpen.addEventListener("click", openChannel);
    ctls.btnCreate.addEventListener("click", newChannel);
    ctls.btnClose.addEventListener("click", closeChannel);

    ctls.btnSend.addEventListener("click", sendTextMessage);
    ctls.btnImage.addEventListener("click", sendImage);
    ctls.btnFile.addEventListener("click", sendFile);
    ctls.btnShell.addEventListener("click", sendShell);

    ctls.txtContent.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (window.shellChannel) {
          sendShell();
        } else {
          sendTextMessage();
        }
      }
    });

    disableOperation(true);
  };
})();

function disableOperation(disabled) {
  ctls.txtContent.disabled = disabled;
  ctls.btnSend.disabled = disabled;
  ctls.btnImage.disabled = disabled;
  ctls.btnFile.disabled = disabled;
  ctls.btnShell.disabled = disabled;
}

function setElStatus(connected) {
  ctls.btnReload.disabled = connected;
  ctls.btnCreate.disabled = connected;
  ctls.btnOpen.disabled = connected;
  ctls.slChannels.disabled = connected;

  ctls.btnClose.disabled = !connected;

  disableOperation(!connected);
}

async function reload() {
  await loadChannels();
}

async function loadChannels(select) {
  const channels = [...new Set(await Api.getChannels())];
  const elChannels = ctls.slChannels;
  elChannels.innerHTML = ""; // clear

  channels
    .map((cid) => {
      const name = `频道${cid}`;
      return buildChannelOption(cid, name, false);
    })
    .forEach((o) => elChannels.appendChild(o));

  if (channels.length === 0) {
    elChannels.appendChild(buildChannelOption(0, "无活跃频道", true));
  }

  if (select) {
    if (channels.includes(select)) {
      elChannels.value = select;
    } else {
      elChannels.appendChild(
        buildChannelOption(select, `频道${select}`, false)
      );
      elChannels.value = select;
    }
  }
}

async function newChannel() {
  if (window.current) return;

  disableElements();
  const ret = await Api.openChannel();
  disableElements(false);
  if (!ret) return;

  await loadChannels(ret.cid);

  startMessageLoop(ret, document.querySelector("#msg"));

  setElStatus(true);

  info(`频道${ret.cid}已创建, 令牌: ${ret.token}`);
}

async function openChannel() {
  if (window.current) return;

  const el = ctls.slChannels;

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

  setElStatus(true);
}

async function sendTextMessage() {
  if (!window.current) return;

  const contentEL = ctls.txtContent;
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

async function sendShell() {
  if (!window.current) return;

  const { cid, token } = window.current;

  if (!window.shellChannel) {
    const command = prompt(
      "请输入要运行的远程终端：\n cmd, powershell, pwsh等",
      "powershell"
    );

    if (!command) return;
    const { shellChannel } = await Api.sendShell(cid, token, command);

    if (!shellChannel) return; // failed to open shell

    window.shellChannel = shellChannel;
    ctls.txtContent.style.backgroundColor = "black";
    ctls.txtContent.style.color = "white";
  } else {
    const command = ctls.txtContent.value;
    if (!command) return;

    await Api.sendShell(cid, token, command, window.shellChannel);

    if (command === "exit") {
      const quitShellMode = confirm("你输入了退出命令，是否退出远程终端模式？");
      if (quitShellMode) {
        window.shellChannel = null;
        ctls.txtContent.style.backgroundColor = "white";
        ctls.txtContent.style.color = "black";
      }
    }

    ctls.txtContent.value = "";
  }
}

async function sendImage() {
  if (!window.current) return;

  selectImage(onImageSelected);

  async function onImageSelected(file) {
    const contentBuffer = await fileToArrayBuffer(file);

    const { cid, token } = window.current;

    await Api.sendImage(cid, token, contentBuffer, file.name);

    const dataUrl = await fileToDataURL(file);
    pushMessageEl(
      { content: dataUrl, type: 2 },
      document.querySelector("#msg"),
      "my-message"
    );
  }
}

async function sendFile() {
  if (!window.current) return;

  selectFile(onFileSelected);

  async function onFileSelected(file) {
    const contentBuffer = await fileToArrayBuffer(file);

    const { cid, token } = window.current;

    await Api.sendFile(cid, token, contentBuffer, file.name);

    pushMessageEl(
      { content: "", fileName: `[FILE] ${file.name}`, type: 1 },
      document.querySelector("#msg"),
      "my-message"
    );
  }
}

async function closeChannel() {
  if (!window.current) return;

  const { cid, token } = window.current;
  if (!token) return;

  disableElements();
  const result = await Api.deleteChannel(cid, token);
  disableElements(false);
  if (!result) return;

  stopMessageLoop();

  info(`频道${cid}已关闭`);

  await loadChannels();

  setElStatus(false);

  if (window.shellChannel) {
    window.shellChannel = null;
    ctls.txtContent.style.backgroundColor = "white";
    ctls.txtContent.style.color = "black";
  }
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

function sysinfo(info) {
  ctls.sysinfo.textContent = `
  Ver.: ${info.version};
  Path/BaudRate: ${info.path} / ${info.baudRate};
  Frames/Dropped: ${info.frames} / ${info.droppedFrames}; 
  Traffic Out/In: ${info.traffic.t_out} / ${info.traffic.t_in} 
  `;
}

function startMessageLoop(ret, msgContainer) {
  const controller = new AbortController();
  window.current = {
    cid: ret.cid,
    token: ret.token,
    task: Api.listenMessage({
      controller,
      cid: ret.cid,
      token: ret.token,
      callback: (type, message) => {
        if (type === 0) {
          pushMessageEl(message, msgContainer, "remote-message");
        } else if (type === 1) {
          sysinfo(message);
        }
      },
    }).then(() => {
      // communication terminated
      closeChannel();
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
  const { content, type, fileName } = message;
  const p = document.createElement("p");

  if (message.type === 0 && (!message.content || !message.content.trim())) {
    // empty message
    return;
  }

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
      if (content) {
        const a = document.createElement("a");
        a.href = content;
        a.textContent = fileName || "[文件]";
        a.download = fileName;

        p.appendChild(a);
      } else {
        p.textContent = fileName || "[文件]";
      }

      break;
    }
    case 2: {
      //image
      const img = document.createElement("img");
      img.src = content;
      img.style.maxWidth = "100%";

      img.onload = function () {
        img.style.width = img.width > 200 ? "200px" : "100%";
        img.style.height = "auto";
        img.style.cursor = "pointer";
        img.addEventListener("click", function () {
          showImageView(content);
        });
      };

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
