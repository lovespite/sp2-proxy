export default function getNextRandomToken() {
  return Math.random().toString(36).substring(2).padStart(12, "0");
}
