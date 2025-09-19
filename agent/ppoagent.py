import cffi
import os

CFFI_LIB = "agent/libagent.so"
C_FUNCTION = "getAction"

class PPOAgent:
    def __init__(self):
        self.name = "PPOAgent"

        self.ffi = cffi.FFI()

        self.ffi.cdef(f"int {C_FUNCTION}(int *state, float *qvals);")
        self.lib = self.ffi.dlopen(os.path.abspath(CFFI_LIB))
        print("CFFI compilation complete.")


    def determine_action(self, state):
        c_state = self.ffi.new("int[]", state)
        c_qvals = self.ffi.new("float[]", [0.0] * len(state))

        result = self.lib.getAction(c_state, c_qvals)

        return result

    def get_qvals(self, state):
        c_state = self.ffi.new("int[]", state)
        c_qvals = self.ffi.new("float[]", [0.0] * len(state))

        result = self.lib.getAction(c_state, c_qvals)

        qvals_out = [c_qvals[i] for i in range(len(state))]

        return qvals_out

