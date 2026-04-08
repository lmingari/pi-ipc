# PI-IPC: pi extension

## WIP
TODO

```bash
  # install deps (creates workspace links)
  npm install

  # build ipc package
  npm run build

  # run server
  npm run example:server

  # run client (in another terminal)
  npm run example:client -- alice
```               

## Explaining re-build necessity

 The extension requires running npm run build because it uses TypeScript via jiti for execution, while the IPC package relies on
 compiled files in the dist directory; thus, building ensures compatibility for the extension.

 Yes—after changing the IPC package you should rebuild it so dist/ updates:

 ```bash
   npm run build
 ```

 Your extension loads TS directly, but it imports ipc from its built dist output.
