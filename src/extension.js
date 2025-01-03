const vscode = require("vscode");
const { Socket } = require("net");
const path = require("path");

const config = {
  command: "macsploit-execute.execute-script",
  button: {
    position: vscode.StatusBarAlignment.Left,
    priority: -10,
  },
  host: "127.0.0.1",
  port: {
    min: 5553,
    max: 5563,
  },
  extensions: ["lua", "luau", "txt"],
  languages: ["lua", "plaintext"],
  interval: 500,
};

let clients = [];
let buttons = [];
let checkLock = false;

function range(min, max) {
  const size = max - min + 1;
  return [...Array(size).keys()].map((i) => i + min);
}

function isValidFile() {
  const editor = vscode.window.activeTextEditor;
  const name = editor && editor.document.fileName;

  const extension = name && path.extname(name).replace(".", "");
  const language = editor && editor.document.languageId;

  return (
    config.extensions.includes(extension) || config.languages.includes(language)
  );
}

function getBuffer(contents) {
  const byteLength = Buffer.byteLength(contents, "utf8");
  const buffer = Buffer.alloc(16 + byteLength + 1);

  buffer.writeUInt8(0, 0);
  buffer.writeUInt32LE(byteLength + 1, 8);

  buffer.write(contents, 16, "utf8");
  buffer.writeUInt8(0, 16 + byteLength);

  return buffer;
}

function execute(port) {
  const client = port !== "all" && clients.find((c) => c.port === port);
  const editor = vscode.window.activeTextEditor;
  const script = editor && editor.document.getText();

  if (client && script) {
    client.socket.write(getBuffer(script));
  } else if (port === "all" && script) {
    const buffer = getBuffer(script);

    for (const { socket } of clients) {
      socket.write(buffer);
    }
  }
}

function clearButtons() {
  for (const { button } of buttons) {
    button.dispose();
  }

  buttons = [];
}

let number = 0;

function addButton(port, all) {
  if (all) port = "all";

  const button = vscode.window.createStatusBarItem(
    config.button.position,
    config.button.priority - number,
  );

  button.text = `$(debug-start) ${all ? "All" : number + 1}`;
  button.command = {
    command: config.command,
    arguments: [port],
  };

  number++;
  buttons.push({
    button,
    port,
  });
}

function setButtons() {
  clearButtons();
  number = 0;

  for (const { port } of clients) {
    addButton(port);
  }

  if (clients.length > 1) {
    addButton(null, true);
  }
}

function showButtons() {
  for (const { button } of buttons) {
    button.show();
  }
}

function hideButtons() {
  for (const { button } of buttons) {
    button.hide();
  }
}

function clearClients() {
  for (const { socket } of clients) {
    socket.destroy();
  }

  clients = [];
}

async function getClient(port) {
  return new Promise(function (resolve, reject) {
    const socket = new Socket();

    socket.on("connect", function () {
      resolve({
        socket,
        port,
      });
    });

    socket.on("error", function () {
      reject();
    });

    socket.on("timeout", function () {
      socket.destroy();
      reject();
    });

    socket.on("close", function () {
      socket.destroy();

      if (clients.find((c) => c.port === port)) {
        clients = clients.filter((c) => c.port !== port);
        setButtons();
      }
    });

    setTimeout(function () {
      if (socket.connecting) {
        reject();
      }
    }, config.interval);

    try {
      socket.connect(port, config.host);
    } catch {
      reject();
    }
  });
}

function checkActive() {
  const hasClients = clients.length > 0;
  const validFile = isValidFile();

  if (hasClients && validFile) showButtons();
  else hideButtons();
}

async function checkClients() {
  if (checkLock) return;
  checkLock = true;

  await getClients();
  checkActive();

  checkLock = false;
}

async function getClients() {
  const ports = range(...Object.values(config.port)).filter(
    (p) => !clients.find(({ port }) => port === p),
  );

  const foundClients = (await Promise.allSettled(ports.map(getClient)))
    .filter((p) => p.status === "fulfilled")
    .map((p) => p.value);

  clients.push(...foundClients);
  if (foundClients.length > 0) setButtons();
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand(config.command, execute),
    vscode.window.onDidChangeActiveTextEditor(checkActive),
  );

  setInterval(checkClients, config.interval);
}

function deactivate() {
  clearClients();
  clearButtons();
}

module.exports = {
  activate,
  deactivate,
};
