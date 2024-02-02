(function () {
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

    raw: async function (url, data) {
      const ret = await fetch(url, {
        method: "POST",
        body: data,
        headers: {
          "content-type": "application/octet-stream",
        },
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

  window.http = http;
})();
