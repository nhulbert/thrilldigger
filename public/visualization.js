const CellType = Object.freeze({
    DUG: -1,
    BOMB: 0,
    RUPOOR: 1,
    GREEN: 2,
    BLUE: 3,
    RED: 4,
    SILVER: 5,
    GOLD: 6
});
const imageCache = {};

const rewardDiv = document.getElementById('rewardDisp');
const canvas = document.getElementById('canvas');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const editor = ace.edit("editor");
editor.setTheme("ace/theme/monokai");
editor.session.setMode("ace/mode/javascript");
editor.setOptions({
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
    enableSnippets: true
});

const ctx = canvas.getContext('2d');
const targetSteps = 10000;
const uploadedFiles = [];
window.uploadedFiles = uploadedFiles;
let envWasm = null;
let agentWasm = null;
let width = 8;
let height = 5;
let numBombs = 8;
let numRupoors = 8;
let state = Array.from({ length: width * height }, _ => -1);

let hiddenState = Array.from({ length: width * height }, _ => -1);
initializeHiddenState(hiddenState);

let qvals = Array.from({ length: width * height }, _ => -1.0);
let actionOverride = null;
let keyarr = [false, false];
let failAnimation = 0;
let lastReward = 0;
let reward = 0;
let agentEvalReward = 0;
let steps = 0;

let determineActionFn;

window.onload = function() {
    loadWasms();
    loadCode();
    determineActionFn(state, qvals); // populate initial q-values
    resizeCanvasToDisplaySize(canvas);
    updateCanvas(state, hiddenState, qvals);
}
window.addEventListener('resize', () => {
    resizeCanvasToDisplaySize(canvas);
    updateCanvas(state, hiddenState, qvals);
});


document.getElementById("stepBtn").addEventListener("click", stepEnv);
document.getElementById("reset").addEventListener("click", resetReward);
document.getElementById("loadCode").addEventListener("click", loadCode);
document.getElementById("scoreAgent").addEventListener("click", runAgentEvaluation);
document.getElementById("uploadScore").addEventListener("click", uploadAgentScore);
document.getElementById("requestAction").addEventListener("click", requestAgentButtonHandler);
document.getElementById("requestQvals").addEventListener("click", requestQvalsButtonHandler);
canvas.addEventListener("contextmenu", cellUpdateHandler);

function resizeCanvasToDisplaySize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;

    // Round up to avoid fractional pixels
    canvas.width = Math.floor(rect.width * scale);
    canvas.height = Math.floor(rect.height * scale);

    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale); // Scale drawing operations

    // Redraw everything here if necessary
}


canvas.addEventListener("click", function(event) {
    const rect = canvas.getBoundingClientRect();

    const cellWidth = rect.width / width;
    const cellHeight = rect.height / height;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const col = Math.floor(x / cellWidth);
    const row = Math.floor(y / cellHeight);

    console.log(`Clicked cell: row ${row}, col ${col}`);
    updateEnvironmentLocal(row * width + col);
});

// Connect to WebSocket server
const wsHost = window.location.host;  // includes hostname + port
const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const ws = createWebSocket(`${protocol}://${wsHost}/leaderboard`, leaderboardHandler, "ws");
const wsAgent = createWebSocket(`${protocol}://${wsHost}/agent`, agentHandler, "ws");
const wsQvals = createWebSocket(`${protocol}://${wsHost}/qvals`, qvalsHandler, "ws");


function createWebSocket(url, onMessage, label = "ws", retryDelay = 1000) {
    let socket;
    let shouldReconnect = true;

    function connect() {
        socket = new WebSocket(url);

        socket.onopen = () => {
            console.log(`[${label}] Connected`);
        };

        socket.onmessage = onMessage;

        socket.onclose = (event) => {
            console.warn(`[${label}] Disconnected`, event.reason);
            if (shouldReconnect) {
                setTimeout(connect, retryDelay);
                console.log(`[${label}] Reconnecting in ${retryDelay}ms...`);
            }
        };

        socket.onerror = (err) => {
            console.error(`[${label}] Error`, err);
            socket.close();
        };
    }

    connect();

    return {
        close: () => {
            shouldReconnect = false;
            socket.close();
        },
        getSocket: () => socket
    };
}

function leaderboardHandler(event) {
    let json = JSON.parse(event.data);
    if (json["type"] === "leaderboard") {
        let leaderboard = json["leaderboard"];
        updateLeaderboard(leaderboard);
    } else if (json["type"] === "scoreAck") {
        if (json["successful"]) {
            alert("Score successfully sent");
        } else {
            alert("Problem sending score")
        }
    }
}

function agentHandler(event) {
    let json = JSON.parse(event.data);
    let serverState = json["state"];
    let agentName = json["agent"];
    let action = json["action"];
    if (areStatesEqual(serverState, state)) {
        updateEnvironmentServer(action, agentName);
    }
    else {
        console.log("Invalid state received from server receiving action");
    }
}

function qvalsHandler(event) {
    let json = JSON.parse(event.data);
    let serverState = json["state"];
    let agentName = json["agent"];
    let qvals = json["qvals"];
    if (areStatesEqual(serverState, state)) {
        updateQvalsServer(qvals, agentName);
    }
    else {
        console.log("Invalid state received from server receiving qvals");
    }
}

function areStatesEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => val === b[i]);
}

function updateLeaderboard(data) {
    const table = document.getElementById("leaderboard");

    // Clear existing rows except the header
    while (table.rows.length > 1) {
        table.deleteRow(1);
    }

    // Populate table with leaderboard data
    data.forEach(([name, score], index) => {
        const row = table.insertRow();

        const rankCell = row.insertCell(0);
        rankCell.textContent = index + 1;

        const nameCell = row.insertCell(1);
        nameCell.textContent = name;

        const scoreCell = row.insertCell(2);
        scoreCell.textContent = score;
    });
}

function getCellImage(fileName, callback) {
    if (imageCache[fileName]) {
        callback(imageCache[fileName]);
    } else {
        const img = new Image();
        img.onload = () => {
            imageCache[fileName] = img;
            callback(img);
        };
        img.src = fileName;
    }
}

function updateCanvas(state, hiddenState, qvals) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let maxQVal = -Infinity;
    let minQVal = Infinity;

    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            let ind = r * width + c;
            if (state[ind] == CellType.DUG) {
                if (qvals[ind] > maxQVal) {
                    maxQVal = qvals[ind];
                } else if (qvals[ind] < minQVal) {
                    minQVal = qvals[ind];
                }
            }
        }
    }

    let range = maxQVal - minQVal;
    let displayWidth = canvas.getBoundingClientRect().width;
    let displayHeight = canvas.getBoundingClientRect().height;
    let cellWidth = displayWidth / width;
    let cellHeight = displayHeight / height;
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            let ind = r * width + c;
            let normQVal = (range < 0.000000001) ? 0 : (qvals[ind] - minQVal) / range;
            let rval = Math.floor(normQVal * 255);
            let bval = 255 - rval;

            let xloc = c * cellWidth;
            let yloc = r * cellHeight;
            ctx.fillStyle = "rgb(" + rval + ", 0, " + bval + ")";
            ctx.fillRect(xloc, yloc, cellWidth, cellHeight);
            // ctx.fillStyle = "black";
            // let cellText = state[ind] + "," + hiddenState[ind];
            // ctx.fillText(cellText, xloc + 0.5 * cellWidth, yloc + 0.5 * cellHeight);

            let cellContents = (state[ind] == CellType.DUG) ? hiddenState[ind] : state[ind];
            if (cellContents != CellType.DUG) {
                let [fileName, _] = Object.entries(CellType).find(([k, v]) => (v == cellContents));
                getCellImage(`${fileName}.png`, (img) => {
                    const imageSize = 0.5;
                    ctx.drawImage(img, xloc + (1 - imageSize) / 2 * cellWidth, yloc + (1 - imageSize) / 2 * cellHeight, cellWidth * imageSize, cellHeight * imageSize);
                });
            }

            if (hiddenState[ind] == CellType.DUG) {
                // Set line style (optional)
                ctx.strokeStyle = "black";
                ctx.lineWidth = 2;

                // Draw a line from (50, 50) to (200, 150)
                ctx.beginPath();
                ctx.moveTo(xloc, yloc);     // Start point
                ctx.lineTo(xloc + cellWidth, yloc + cellHeight);   // End point
                ctx.stroke();           // Render the line
                ctx.beginPath();
                ctx.moveTo(xloc + cellWidth, yloc);
                ctx.lineTo(xloc, yloc + cellHeight);
                ctx.stroke();
            }

        }
    }

    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            let xloc = c * cellWidth;
            let yloc = r * cellHeight;
            ctx.fillStyle = "black";
            ctx.strokeRect(xloc, yloc, cellWidth, cellHeight);
        }
    }
}

function updateSummaryText() {
    if (steps > 0) {
        rewardDiv.textContent = "Steps: " + steps + ", Total reward: " + reward + ", Per step: " + (reward / steps);
    } else {
        rewardDiv.textContent = "Reward: " + lastReward + ", Total reward: " + reward;
    }
}

// Draw the CartPole environment
function updateEnvironmentLocal(action) {
    if (state[action] == CellType.DUG) {
        updateState(state, hiddenState, qvals, action);
        updateCanvas(state, hiddenState, qvals);
        updateSummaryText();
    }
}

function updateEnvironmentServer(action, agentName) {
    updateStateServer(state, hiddenState, action);
    requestAgentQvals(state, agentName);
}

function updateQvalsServer(qvals, agentName) {
    updateCanvas(state, hiddenState, qvals);
    updateSummaryText();
}

function countNearby(arr, r, c) {
    let count = 0;
    for (let i = -1; i <= 1; i++) {
        for (let h = -1; h <= 1; h++) {
            let ind = (r + i) * width + (c + h);
            if ((i != 0 || h != 0) &&
                (r + i >= 0 && r + i < height && c + h >= 0 && c + h < width) &&
                (arr[ind] == CellType.BOMB || arr[ind] == CellType.RUPOOR)) {
                count++;
            }
        }
    }
    return count;
}

function initializeHiddenState(hiddenState) {
    let remBombs = numBombs;
    let remRupoors = numRupoors;
    let remSpots = hiddenState.length;

    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            let ind = r * width + c;
            let sampled = Math.floor(Math.random() * remSpots);
            let val = CellType.DUG;
            if (sampled < remBombs) {
                val = CellType.BOMB;
                remBombs--;
            } else if (sampled < remBombs + remRupoors) {
                val = CellType.RUPOOR;
                remRupoors--;
            }
            hiddenState[ind] = val;
            remSpots--;
        }
    }

    fillInHiddenState(hiddenState);
}

function undoHiddenStateMoves(state, hiddenState) {
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            let ind = r * width + c;
            if (state[ind] !== CellType.DUG) {
                hiddenState[ind] = state[ind];
                console.log("undoing " + r + ", " + c);
            }
        }
    }
}

function fillInHiddenState(hiddenState) {
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            let ind = r * width + c;
            if (hiddenState[ind] != CellType.BOMB && hiddenState[ind] != CellType.RUPOOR) {
                let count = countNearby(hiddenState, r, c);
                if (count < 1) {
                    hiddenState[ind] = CellType.GREEN;
                } else if (count < 3) {
                    hiddenState[ind] = CellType.BLUE;
                } else if (count < 5) {
                    hiddenState[ind] = CellType.RED;
                } else if (count < 7) {
                    hiddenState[ind] = CellType.SILVER;
                } else {
                    hiddenState[ind] = CellType.GOLD;
                }
            }
        }
    }
}

function replayMoves(state, hiddenState) {
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            let ind = r * width + c;
            if (state[ind] != CellType.DUG) {
                state[ind] = hiddenState[ind];
                hiddenState[ind] = CellType.DUG;
            }
        }
    }
}

function updateState(state, hiddenState, qvals, actionOverride) {
    const exports = envWasm.instance.exports;
    const memory = exports.memory.buffer;
    const statePtr = exports.malloc(width * height * Int32Array.BYTES_PER_ELEMENT);  // Allocate space in WASM memory
    const hiddenStatePtr = exports.malloc(width * height * Int32Array.BYTES_PER_ELEMENT);  // Allocate space in WASM memory
    const nextStatePtr = exports.malloc(width * height * Int32Array.BYTES_PER_ELEMENT);
    const nextHiddenStatePtr = exports.malloc(width * height * Int32Array.BYTES_PER_ELEMENT);
    const donePtr = exports.malloc(1 * Int32Array.BYTES_PER_ELEMENT);
    const rewardPtr = exports.malloc(1 * Float32Array.BYTES_PER_ELEMENT);
    const durationPtr = exports.malloc(1 * Float32Array.BYTES_PER_ELEMENT);
    const stateArray = new Int32Array(memory, statePtr, width * height);  // Create a JS view into WASM memory
    const hiddenStateArray = new Int32Array(memory, hiddenStatePtr, width * height);  // Create a JS view into WASM memory
    const nextStateArray = new Int32Array(memory, nextStatePtr, width * height);  // Create a JS view into WASM memory
    const nextHiddenStateArray = new Int32Array(memory, nextHiddenStatePtr, width * height);  // Create a JS view into WASM memory
    const doneArray = new Int32Array(memory, donePtr, 1);
    const rewardArray = new Float32Array(memory, rewardPtr, 1);

    // Set arbitrary float values
    stateArray.set(state);
    hiddenStateArray.set(hiddenState);

    // Call the WASM function

    let action = (actionOverride === 0 || actionOverride) ? actionOverride : determineActionFn(state, qvals);
    exports.compute_env_state(hiddenStatePtr, statePtr, action, nextHiddenStatePtr,
        nextStatePtr, donePtr, rewardPtr, durationPtr);

    if (doneArray[0]) {
        initializeHiddenState(nextHiddenStateArray);
        for (let i = 0; i < nextStateArray.length; i++) {
            nextStateArray[i] = -1;
        }
    }
    determineActionFn(nextStateArray, qvals);

    lastReward = Math.floor(500 * rewardArray[0] + 0.5);
    reward += lastReward;

    for (let i = 0; i < stateArray.length; i++) {
        state[i] = nextStateArray[i];
        hiddenState[i] = nextHiddenStateArray[i];
    }

    // Free memory
    exports.free(statePtr);
    exports.free(hiddenStatePtr);
    exports.free(nextStatePtr);
    exports.free(nextHiddenStatePtr);
    exports.free(donePtr);
    exports.free(rewardPtr);
    exports.free(durationPtr);
}

function updateStateServer(state, hiddenState, action) {
    const exports = envWasm.instance.exports;
    const memory = exports.memory.buffer;
    const statePtr = exports.malloc(width * height * Int32Array.BYTES_PER_ELEMENT);  // Allocate space in WASM memory
    const hiddenStatePtr = exports.malloc(width * height * Int32Array.BYTES_PER_ELEMENT);  // Allocate space in WASM memory
    const nextStatePtr = exports.malloc(width * height * Int32Array.BYTES_PER_ELEMENT);
    const nextHiddenStatePtr = exports.malloc(width * height * Int32Array.BYTES_PER_ELEMENT);
    const donePtr = exports.malloc(1 * Int32Array.BYTES_PER_ELEMENT);
    const rewardPtr = exports.malloc(1 * Float32Array.BYTES_PER_ELEMENT);
    const durationPtr = exports.malloc(1 * Float32Array.BYTES_PER_ELEMENT);
    const stateArray = new Int32Array(memory, statePtr, width * height);  // Create a JS view into WASM memory
    const hiddenStateArray = new Int32Array(memory, hiddenStatePtr, width * height);  // Create a JS view into WASM memory
    const nextStateArray = new Int32Array(memory, nextStatePtr, width * height);  // Create a JS view into WASM memory
    const nextHiddenStateArray = new Int32Array(memory, nextHiddenStatePtr, width * height);  // Create a JS view into WASM memory
    const doneArray = new Int32Array(memory, donePtr, 1);
    const rewardArray = new Float32Array(memory, rewardPtr, 1);

    stateArray.set(state);
    hiddenStateArray.set(hiddenState);

    // Call the WASM function
    exports.compute_env_state(hiddenStatePtr, statePtr, action, nextHiddenStatePtr,
        nextStatePtr, donePtr, rewardPtr, durationPtr);

    if (doneArray[0]) {
        initializeHiddenState(nextHiddenStateArray);
        for (let i = 0; i < nextStateArray.length; i++) {
            nextStateArray[i] = -1;
        }
    }

    lastReward = Math.floor(500 * rewardArray[0] + 0.5);
    reward += lastReward;

    for (let i = 0; i < stateArray.length; i++) {
        state[i] = nextStateArray[i];
        hiddenState[i] = nextHiddenStateArray[i];
    }

    // Free memory
    exports.free(statePtr);
    exports.free(hiddenStatePtr);
    exports.free(nextStatePtr);
    exports.free(nextHiddenStatePtr);
    exports.free(donePtr);
    exports.free(rewardPtr);
    exports.free(durationPtr);
}


async function loadWasms() {
    loadEnvWasm();
}

async function loadEnvWasm() {
    const response = await fetch("env.wasm");
    envWasm = await WebAssembly.instantiateStreaming(response, {
        env: {
            __memory_base: 0,  // Provide default integer value
            __table_base: 0,   // Provide default integer value
            __stack_pointer: new WebAssembly.Global({ value: "i32", mutable: true }, 0),  // Fix here
            memory: new WebAssembly.Memory({ initial: 1 })  // Provide memory
        }
    });

    console.log("Env wasm loaded successfully");
}

async function stepEnv() {
    // if agent evaluation is not running
    if (steps == 0) {
        updateEnvironmentLocal(null);
    }
}

async function resetReward() {
    if (steps == 0) {
        lastReward = 0;
        reward = 0;
        updateSummaryText();
    }
}

async function runAgentEvaluation() {
    if (steps == 0) {
        reward = 0;
    }
    updateEnvironmentLocal(null);
    if (steps < targetSteps) {
        steps += 1;
        requestAnimationFrame(runAgentEvaluation);
    }
    else {
        agentEvalReward = reward;
        steps = 0;
        reward = 0;
    }
}

async function loadWasm() {
    const fileInput = document.getElementById("wasmUpload");
    const output = document.getElementById("output");

    if (fileInput.files.length === 0) {
        output.textContent = "Please upload a WASM file.";
        return;
    }

    const file = fileInput.files[0];
    const arrayBuffer = await file.arrayBuffer();
    const wasmModule = await WebAssembly.instantiate(arrayBuffer, {});

    output.textContent = "WASM Loaded Successfully!";

    // Example: Call an exported function named "run"
    if (wasmModule.instance.exports.run) {
        output.textContent += "\nResult: " + wasmModule.instance.exports.run();
    } else {
        output.textContent += "\nNo 'run' function found in WASM.";
    }
}

function loadCode() {
    if (steps == 0) {
        const codeString = editor.getValue();
        let userFunction = Function('"use strict"; return (' + codeString + ')')();

        try {
            determineActionFn = userFunction;
        } catch (e) {
            console.error("Error:", e);
        }
    }
}

function uploadAgentScore() {
    const name = prompt("Enter the agent name:");
    sendAgentScore(name, agentEvalReward);
}

function sendAgentScore(name, score) {
    const scoreData = {
        name: name,
        score: score
    };

    ws.getSocket().send(JSON.stringify(scoreData));
}

function requestAgentButtonHandler() {
    const selectedValue = document.getElementById("agentList").value;
    requestAgentAction(state, selectedValue);
}

function requestQvalsButtonHandler() {
    const selectedValue = document.getElementById("agentList").value;
    requestAgentQvals(state, selectedValue);
}

function cellUpdateHandler(e) {
    e.preventDefault(); // prevent default browser menu

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const cellX = Math.floor(mouseX / (canvas.width / width));
    const cellY = Math.floor(mouseY / (canvas.height / height));
    const cellIndex = cellY * width + cellX;

    showCellDropdown(e.clientX, e.clientY, cellIndex);
}

function showCellDropdown(x, y, cellIndex) {
    const menu = document.createElement("select");
    menu.style.position = "absolute";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.zIndex = 1000;

    const options = [
        { label: "Empty", value: CellType.DUG },
        { label: "Bomb", value: CellType.BOMB },
        { label: "Rupoor", value: CellType.RUPOOR }
    ];

    options.forEach(({ label, value }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        menu.appendChild(option);
    });

    let currentValue = (state[cellIndex] === CellType.DUG) ? hiddenState[cellIndex] : state[cellIndex];
    if (currentValue > CellType.RUPOOR) currentValue = CellType.DUG;
    menu.value = currentValue;

    let removed = false;
    function removeMenu() {
        if (!removed && document.body.contains(menu)) {
            removed = true;
            document.body.removeChild(menu);
        }
    }

    menu.addEventListener("change", () => {
        let newVal = parseInt(menu.value);
        if (newVal !== CellType.BOMB || state[cellIndex] === CellType.DUG) {
            undoHiddenStateMoves(state, hiddenState);
            hiddenState[cellIndex] = newVal;
            fillInHiddenState(hiddenState);
            replayMoves(state, hiddenState);
            updateCanvas(state, hiddenState, qvals);
        }
        removeMenu();
    });

    document.body.appendChild(menu);
    menu.focus();

    menu.addEventListener("blur", () => {
        removeMenu();
    });
}

fileInput.addEventListener('change', (event) => {
    const newFiles = Array.from(event.target.files);

    // Add new files to the list
    uploadedFiles.push(...newFiles);

    fileList.innerHTML = "";
    for (const file of uploadedFiles) {
        const item = document.createElement('li');
        item.textContent = file.name + ", " + file.size + ", " + file.type;
        fileList.appendChild(item);
    }
});

function requestAgentAction(state, agentName) {
    console.log("Requesting agent action");
    const agentStateData = {
        agent: agentName,
        state: state
    }

    wsAgent.getSocket().send(JSON.stringify(agentStateData));
}

function requestAgentQvals(state, agentName) {
    console.log("Requesting agent qvals");
    const agentStateData = {
        agent: agentName,
        state: state
    }

    wsQvals.getSocket().send(JSON.stringify(agentStateData));
}
