const map = new Map<string, string>();
const args: [string, string][] = [];
let command: string | undefined;

export function parse(str: string[]) {
  command = str[0];

  str.slice(1).forEach(s => {
    let [name, value] = s.split("=").map(x => x.trim());
    while (name.startsWith("-")) {
      name = name.slice(1);
    }
    if (!name) return;
    map.set(name, value);
    args.push([name, value]);
  });
}

export function getArgs() {
  return Array.from(args);
}

export function getCommand() {
  return command;
}

export function getOptions() {
  const o: { [key: string]: string | undefined } = {};
  map.forEach((v, k) => {
    o[k] = v;
  });
  return o;
}

export function hasOption(name: string, alias?: string) {
  return map.has(name) || map.has(alias);
}

export function getOption(name: string, alias?: string, defaultValue?: string) {
  return map.get(name) || map.get(alias) || defaultValue;
}
