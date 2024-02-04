let counter = 0;
const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function getNextCount() {
  return counter++;
}

export default function getNextRandomToken() {
  return (
    toBase62(Math.ceil(Math.random() * 0xffffffff)) +
    getNextCount().toString(36) +
    toBase62(Date.now())
  );
}

function toBase62(num: number) {
  const base = chars.length;
  let result = "";
  while (num > 0) {
    result = chars[num % base] + result;
    num = Math.floor(num / base);
  }
  return result || "0";
}
