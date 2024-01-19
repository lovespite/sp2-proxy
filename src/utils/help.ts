export default function printUsage() {
  console.log(`Usage: node ${process.argv[1]} <command> [options]`);
  console.log("General options:");
  console.log(`  --serial-port, -s <path>`);
  console.log(`    Specify the serial port to connect.`);
  console.log(`    Default: . (Use the first available port)`);
  console.log(`  --baud-rate, -b <baudRate>`);
  console.log(`    Specify the baud rate.`);
  console.log(`    Default: 1600000`);
  console.log(``);
  console.log(`Commands:`);
  console.log(`  list`);
  console.log(`    List all available serial ports.`);
  console.log(`  proxy [options]`);
  console.log(`    Start the intermedia proxy server.`);
  console.log(`    Options:`);
  console.log(`      --listen, -l <ip>`);
  console.log(`        Specify the IP address to listen.`);
  console.log(`        Default: 0.0.0.0`);
  console.log(`      --port, -p <port>`);
  console.log(`        Specify the port to listen.`);
  console.log(`        Default: 13808`);
  console.log(`  host [options]`);
  console.log(`    Start the host proxy server, where the real traffic outlets.`);
}
