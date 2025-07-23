import os

import subprocess
import cffi
import random

from environment import Environment


C_FILE = "thrilldigger/thrilldigger.c"
C_FUNCTION = "compute_env_state"

PUBLIC_DIR = "public"
AGENT_BUILD_DIR = "thrilldigger/build"

class ThrilldiggerEnv(Environment):

    def __init__(self):
        self.thrilldigger_lib, self.ffi = self.compile_cffi()
        self.compile_env_wasm()


    def compile_cffi(self):

        CFFI_LIB = "thrilldigger.so"  # Change to "thrilldigger.so" on Linux/macOS

        # CFFI_COMPILE_CMD = [
        #
        #
        #     "gcc", "-shared", "-o", CFFI_LIB, "-m64",
        #
        #
        #     "-Wl,--output-def,thrilldigger.def", "-Wl,--out-implib,thrilldigger.a", C_FILE
        #
        #
        # ]

        CFFI_COMPILE_CMD = [
            "gcc", "-shared", "-o", CFFI_LIB, "-m64",
            "-fPIC",  # Position-independent code is required for shared libs
            C_FILE
        ]

        if os.path.exists(CFFI_LIB):

            os.remove(CFFI_LIB)


        """Compile the CFFI shared library."""

        print("Compiling CFFI shared library...")

        subprocess.run(CFFI_COMPILE_CMD, check=True)

        ffi = cffi.FFI()

        ffi.cdef(f"void {C_FUNCTION}(int *state, int *hidden_state, int action, int *nextstate, int *nexthidden_state, int *done, float *reward, float *duration);")

        out = ffi.dlopen(os.path.abspath(CFFI_LIB))
        print("CFFI compilation complete.")

        return out, ffi



    def compile_env_wasm(self):


        WASM_FILE = PUBLIC_DIR + "/" + "env.wasm"

        if os.path.exists(WASM_FILE):

            os.remove(WASM_FILE)

        WASM_COMPILE_CMD = [
            "emcc", "-o", WASM_FILE, C_FILE,
            "--no-entry",
            "-s", f"EXPORTED_FUNCTIONS=['_{C_FUNCTION}','_malloc','_free']",
            "-s", "STANDALONE_WASM=1"
        ]


        """Compile the WebAssembly module."""

        print("Compiling env WASM module...")

        subprocess.run(WASM_COMPILE_CMD, check=True)

        print("env WASM compilation complete.")
