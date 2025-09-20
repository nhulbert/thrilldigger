import cffi
import os

CFFI_LIB = "agent/libdistagent.so"
C_FUNCTION = "getAction"

class DistAgent:
    def __init__(self):
        self.name = "DistAgent"

        try:
            self.ffi = cffi.FFI()

            self.ffi.cdef(f"int {C_FUNCTION}(int *state, float *qvals);")
            self.lib = self.ffi.dlopen(os.path.abspath(CFFI_LIB))
            print(f"{self.name} CFFI compilation complete.")
        except:
            print(f"Unable to load {self.name} agent")


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


