const vscode = require("vscode");
const { Socket } = require("net");
const path = require("path");

const config = {
  command: "macsploit-execute.execute-script",
  button: {
    position: vscode.StatusBarAlignment.Left,
    priority: 0,
  },
  host: "127.0.0.1",
  port: {
    min: 5553,
    max: 5563,
  },
  extensions: ["lua", "luau", "txt"],
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
    config.extensions.includes(extension) ||
    config.extensions.includes(language)
  );
}

function getBuffer(contents) {
  const buffer = Buffer.alloc(16 + contents.length + 1);

  buffer.writeUInt8(0, 0);
  buffer.writeUInt32LE(contents.length + 1, 8);

  buffer.write(contents, 16);
  buffer.writeUInt8(0, 16 + contents.length);

  return buffer;
}

function execute(port) {
  const client = clients.find((c) => c.port === port);
  const editor = vscode.window.activeTextEditor;
  const script = editor && editor.document.getText();

  if (client && script) {
    client.socket.write(getBuffer(script));
  }
}

function clearButtons() {
  buttons.forEach(function ({ button }) {
    button.dispose();
  });

  buttons = [];
}

function setButtons() {
  clearButtons();
  clients.forEach(function ({ port }) {
    const number = port - config.port.min;
    const button = vscode.window.createStatusBarItem(
      config.button.position,
      config.button.priority - number,
    );

    button.text = `Execute [${number + 1}]`;
    button.command = {
      command: config.command,
      arguments: [port],
    };

    buttons.push({
      button,
      port,
    });
  });
}

function showButtons() {
  buttons.forEach(({ button }) => button.show());
}

function hideButtons() {
  buttons.forEach(({ button }) => button.hide());
}

function clearClients() {
  clients.forEach(function (client) {
    client.socket.destroy();
  });

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
