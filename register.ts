const dryRun = Deno.args.includes("--dry-run");
const appPath = await Deno.realPath(new URL("./neuromd.ts", import.meta.url));
const denoPath = Deno.execPath();
const progId = "NeuroMD.Markdown";
const classes = "HKCU\\Software\\Classes";
const capabilities = "HKCU\\Software\\NeuroMD\\Capabilities";
const openCommand =
  `"${denoPath}" run --allow-read --deny-write --deny-net --deny-run --deny-ffi "${appPath}" "%1"`;

async function reg(...args: string[]): Promise<void> {
  if (dryRun) {
    console.log(`reg.exe ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
    return;
  }

  const result = await new Deno.Command("reg.exe", {
    args,
    stdout: "null",
    stderr: "piped",
  }).output();

  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr).trim());
  }
}

await reg(
  "add",
  `${classes}\\${progId}`,
  "/ve",
  "/t",
  "REG_SZ",
  "/d",
  "NeuroMD Markdown Document",
  "/f",
);
await reg(
  "add",
  `${classes}\\${progId}\\Application`,
  "/v",
  "ApplicationName",
  "/t",
  "REG_SZ",
  "/d",
  "NeuroMD",
  "/f",
);
await reg(
  "add",
  `${classes}\\${progId}\\Application`,
  "/v",
  "ApplicationDescription",
  "/t",
  "REG_SZ",
  "/d",
  "Read-only Rust/WASM terminal Markdown viewer",
  "/f",
);
await reg(
  "add",
  `${classes}\\${progId}\\DefaultIcon`,
  "/ve",
  "/t",
  "REG_SZ",
  "/d",
  `${denoPath},0`,
  "/f",
);
await reg(
  "add",
  `${classes}\\${progId}\\shell\\open\\command`,
  "/ve",
  "/t",
  "REG_SZ",
  "/d",
  openCommand,
  "/f",
);
await reg(
  "add",
  `${classes}\\.md\\OpenWithProgids`,
  "/v",
  progId,
  "/t",
  "REG_NONE",
  "/f",
);

await reg(
  "add",
  capabilities,
  "/v",
  "ApplicationName",
  "/t",
  "REG_SZ",
  "/d",
  "NeuroMD",
  "/f",
);
await reg(
  "add",
  capabilities,
  "/v",
  "ApplicationDescription",
  "/t",
  "REG_SZ",
  "/d",
  "Read-only Rust/WASM terminal Markdown viewer",
  "/f",
);
await reg(
  "add",
  `${capabilities}\\FileAssociations`,
  "/v",
  ".md",
  "/t",
  "REG_SZ",
  "/d",
  progId,
  "/f",
);
await reg(
  "add",
  "HKCU\\Software\\RegisteredApplications",
  "/v",
  "NeuroMD",
  "/t",
  "REG_SZ",
  "/d",
  "Software\\NeuroMD\\Capabilities",
  "/f",
);

if (dryRun) {
  console.log("Dry run complete; no registry values were changed.");
} else {
  console.log("NeuroMD is registered as an available Markdown handler.");
  console.log(
    "Choose NeuroMD for .md on the Default Apps page that is opening.",
  );
  new Deno.Command("explorer.exe", {
    args: ["ms-settings:defaultapps?registeredAppUser=NeuroMD"],
    stdout: "null",
    stderr: "null",
  }).spawn().unref();
}
