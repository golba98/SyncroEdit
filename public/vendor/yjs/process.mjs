const process = {
  argv: [],
  env: {},
  release: {},
  stdout: {
    isTTY: false,
  },
};

export const argv = process.argv;
export const env = process.env;
export const release = process.release;
export const stdout = process.stdout;
export default process;
