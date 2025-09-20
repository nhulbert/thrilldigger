from multiprocessing import Process, Pipe

C_FUNCTION = "getAction"


def native_worker(conn, path):
    import cffi
    import os
    ffi = cffi.FFI()
    ffi.cdef("int getAction(int *state, float *qvals);")
    lib = ffi.dlopen(os.path.abspath(path))

    while True:
        state = conn.recv()
        c_state = ffi.new("int[]", state)
        c_qvals = ffi.new("float[]", [0.0] * len(state))
        try:
            result = lib.getAction(c_state, c_qvals)
            qvals_out = [c_qvals[i] for i in range(len(state))]
            conn.send((result, qvals_out))
        except Exception as e:
            conn.send(("error", str(e)))


class NativeAgent:
    def __init__(self, name, path):
        self.name = name
        self.path = path
        self.parent_conn, self.child_conn, self.p = self.startProcess()


    def startProcess(self):
        parent_conn, child_conn = Pipe()
        p = Process(target=native_worker, args=(child_conn, self.path))
        p.start()
        return parent_conn, child_conn, p


    def pollWorker(self):
        if self.parent_conn.poll(1.0):  # wait up to 1 second
            return self.parent_conn.recv()
        else:
            print(f"{self.name} timeout waiting for response")
            return None


    def determine_action(self, state):
        if self.p.exitcode is not None:
            print(f"{self.name} subprocess exited with code {self.p.exitcode}")
            self.parent_conn, self.child_conn, self.p = self.startProcess()
        self.parent_conn.send(state)
        action, qvals = self.pollWorker()
        return action


    def get_qvals(self, state):
        if self.p.exitcode is not None:
            print(f"{self.name} subprocess exited with code {self.p.exitcode}")
            self.parent_conn, self.child_conn, self.p = self.startProcess()
        self.parent_conn.send(state)
        action, qvals = self.pollWorker()
        return qvals

