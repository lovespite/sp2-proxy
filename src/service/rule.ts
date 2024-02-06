import { DataType, f_exists, read_file } from "../utils/fsys";

type JsonRuleItem = {
  src_host: string;
  src_port?: number;
  des_host: string;
  des_port?: number;
};

type RuleItem = {
  src_reg: RegExp;
  src_port?: number;
  des_host: string;
  des_port?: number;
};

type MappingResult = [string, number];

export class Rule {
  private readonly _rules: RuleItem[];

  private constructor() {
    this._rules = [];
  }

  public static async loadRule() {
    const ruleFile = process.env.HOST_MAPPING_FILE || "hosts.json";

    if (!(await f_exists(ruleFile))) {
      console.log("[RULE] warning: no rule file found", ruleFile);
      return new Rule();
    }

    const rule = new Rule();

    const data = (await read_file(ruleFile, DataType.STRING)) as string;

    const rules = JSON.parse(data) as JsonRuleItem[];

    for (const r of rules) {
      // the latest rule should be the first one
      rule._rules.unshift(parseRule(r));
    }

    console.log("[RULE] loaded", rule._rules.length, "rules");

    return rule;
  }

  public get(host: string, port: number): MappingResult {
    for (const r of this._rules) {
      // if the host is not matched
      if (!r.src_reg.test(host)) continue;

      // if the port is defined and not matched
      if (r.src_port && r.src_port !== port) continue;

      console.log(
        "[RULE] redirect",
        host,
        port,
        " => ",
        r.des_host,
        r.des_port || port
      );
      // if the rule is matched
      return [r.des_host, r.des_port || port];
    }

    // if no rule is matched, return the original host and port
    return [host, port];
  }

  public getAsync(host: string, port: number): Promise<MappingResult> {
    return new Promise((resolve) => {
      resolve(this.get(host, port));
    });
  }
}

function parseRule(rule: JsonRuleItem): RuleItem {
  const r = rule.src_host.replace(/\./g, "\\.").replace(/\*/g, ".*");
  return {
    src_reg: new RegExp(r),
    src_port: rule.src_port,
    des_host: rule.des_host,
    des_port: rule.des_port || rule.src_port,
  };
}
