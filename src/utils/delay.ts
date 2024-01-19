export default async function delay(msTimeOut: number) {
  return new Promise(resolve => setTimeout(resolve, msTimeOut));
}
