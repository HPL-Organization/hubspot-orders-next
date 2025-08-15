import { nsClient } from "./base";

/** SuiteQL runner  */
export async function runSuiteQL(q: string) {
  const client = await nsClient();
  const { data } = await client.post(
    "/query/v1/suiteql",
    { q },
    { headers: { Prefer: "transient" } }
  );
  return data?.items ?? [];
}
