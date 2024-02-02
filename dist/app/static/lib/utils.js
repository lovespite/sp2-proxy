async function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 将 File 对象转换为 ArrayBuffer。
 * @param {File} file - 需要转换的 File 对象。
 * @returns {Promise<ArrayBuffer>} 转换后的 ArrayBuffer 对象的 Promise。
 */
function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    // 创建 FileReader 实例
    const reader = new FileReader();

    // 文件读取成功时触发
    reader.onload = () => {
      resolve(reader.result);
    };

    // 文件读取失败时触发
    reader.onerror = () => {
      reject(reader.error);
    };

    // 读取文件
    reader.readAsArrayBuffer(file);
  });
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

function selectFile(callback) {
  // 创建一个 input 元素用于选择文件
  var fileInput = document.createElement("input");
  fileInput.type = "file";

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

function disableElements(disabled = true) {
  document.querySelectorAll("button").forEach((el) => (el.disabled = disabled));
  document.querySelectorAll("input").forEach((el) => (el.disabled = disabled));
  document.querySelectorAll("select").forEach((el) => (el.disabled = disabled));
}

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

function showImageView(content) {
  const w = window.open(
    "about:blank",
    "_img_viewer",
    "width=800,height=600,resizable=1,scrollbars=1,location=0,toolbar=0"
  );
  w.document.write(
    `<img src="${content}" style="
    max-width:100%;
    max-height:100%;
    box-shadow: 0 0 10px #ffffffee;
    "/>`
  );
  w.document.title = "图片预览";
  w.document.body.style.backgroundColor = "#000000a0";
  w.document.body.style.display = "flex";
  w.document.body.style.justifyContent = "center";
  w.document.body.style.alignItems = "center";
}
