let counter = 0;

function getNextCount() {
  return counter++;
}

export default function getNextRandomToken() {
  return getNextCount().toString(36);
}
