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
const targetSteps = 100;
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
    updateCanvas(state, hiddenState, qvals);
}

canvas.width = 600;
canvas.height = 400;

document.getElementById("stepBtn").addEventListener("click", stepEnv);
document.getElementById("reset").addEventListener("click", resetReward);
document.getElementById("loadCode").addEventListener("click", loadCode);
document.getElementById("scoreAgent").addEventListener("click", runAgentEvaluation);
document.getElementById("uploadScore").addEventListener("click", uploadAgentScore);
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


canvas.addEventListener("click", function(event) {
    const rect = canvas.getBoundingClientRect();

    const cellWidth = canvas.width / width;
    const cellHeight = canvas.height / height;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const col = Math.floor(x / cellWidth);
    const row = Math.floor(y / cellHeight);

    console.log(`Clicked cell: row ${row}, col ${col}`);
    updateEnvironmentLocal(row * width + col);
});

// Connect to WebSocket server
const wsHost = window.location.host;  // includes hostname + port
const ws = new WebSocket(`wss://${wsHost}/leaderboard`);

ws.onmessage = (event) => {
    let json = JSON.parse(event.data);
    if (json["type"] === "leaderboard") {
        let leaderboard = json["leaderboard"];
        updateLeaderboard(leaderboard);
    } else if (json["type"] === "scoreAck") {
        alert("Score successfully sent");
    }
};

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
    let cellWidth = canvas.width / width;
    let cellHeight = canvas.height / height;
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
    updateState(state, hiddenState, qvals, action);
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


function updateState(state, hiddenState, qvals, actionOverride) {
    // Allocate memory
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

    // let isDone = exports.compute_env_state(statePtr, Math.floor(Math.random() * 2));
    let action = actionOverride ? actionOverride : determineActionFn(state, qvals);
    exports.compute_env_state(hiddenStatePtr, statePtr, action, nextHiddenStatePtr,
        nextStatePtr, donePtr, rewardPtr, durationPtr);

    if (doneArray[0]) {
        initializeHiddenState(nextHiddenStateArray);
        for (let i = 0; i < nextStateArray.length; i++) {
            nextStateArray[i] = -1;
        }
    }
    else {
        // update the qvals to those after the action is taken to render
        determineActionFn(nextStateArray, qvals);
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

    ws.send(JSON.stringify(scoreData));
}

