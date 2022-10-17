import { compile, buildContractClass, Bytes, Sig, SigHashPreimage, Int} from 'scryptlib';
import { createRequire} from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const path = require('path');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const {
  readFileSync,
  existsSync,
  mkdirSync
} = require('fs')
const {
  bsv,
  compileContract: compileContractImpl,
  getPreimage,
  toHex
} = require('scryptlib')
const crypto = require('crypto');
const MSB_THRESHOLD = 0x7e;

const BN = bsv.crypto.BN
const Interpreter = bsv.Script.Interpreter

// number of bytes to denote some numeric value
const DataLen = 1

const axios = require('axios')
export const API_PREFIX = 'https://api.whatsonchain.com/v1/bsv/test'

export const inputIndex = 0
export const inputSatoshis = 100000
export const dummyTxId = crypto.randomBytes(32).toString('hex');
export const reversedDummyTxId =  Buffer.from(dummyTxId, 'hex').reverse().toString('hex');
export const sighashType2Hex = s => s.toString(16)

const { exit } = require('process');

// fill in private key on testnet in WIF here
const privKey = 'cUS5fdQ7P26VsWuFcBzLt7Jemcx2ho2sgUPnZDGjhP7DLounEegj'

// be default, you do NOT fill in these two, since they are only needed when multiple keys are required
const privKey2 = ''
const privKey3 = ''

if (!privKey) {
  genPrivKey()
}

export function genPrivKey() {
  const newPrivKey = new bsv.PrivateKey.fromRandom('testnet')
  console.log(`Missing private key, generating a new one ...
Private key generated: '${newPrivKey.toWIF()}'
You can fund its address '${newPrivKey.toAddress()}' from sCrypt faucet https://scrypt.io/#faucet`)
  exit(-1)
}

export const privateKey = new bsv.PrivateKey.fromWIF(privKey)

export const privateKey2 = privKey2 ? new bsv.PrivateKey.fromWIF(privKey2) : privateKey

export const privateKey3 = privKey3 ? new bsv.PrivateKey.fromWIF(privKey3) : privateKey

export function newTx() {
  const utxo = {
    txId: dummyTxId,
    outputIndex: 0,
    script: '',   // placeholder
    satoshis: inputSatoshis
  };
  return new bsv.Transaction().from(utxo);
}



// reverse hexStr byte order
export function reverseEndian(hexStr) {
  return hexStr.match(/../g).reverse().join('')
}


export async function sendTx(tx) {
  const hex = tx.toString();

  if(!tx.checkFeeRate(50)) {
    throw new Error(`checkFeeRate fail, transaction fee is too low`)
  }

  try {
    const {
      data: txid
    } = await axios.post(`${API_PREFIX}/tx/raw`, {
      txhex: hex
    });
      
    return txid
  } catch (error) {
    if (error.response && error.response.data === '66: insufficient priority') {
      throw new Error(`Rejected by miner. Transaction with fee is too low: expected Fee is ${expectedFee}, but got ${fee}, hex: ${hex}`)
    } 
    throw error
  }

}

export function compileContract(fileName, options) {
  const filePath = path.join(__dirname, fileName)
  const out = path.join(__dirname, 'out')

  const result = compileContractImpl(filePath, options ? options : {
    out: out
  });
  if (result.errors.length > 0) {
    console.log(`Compile contract ${filePath} failed: `, result.errors)
    throw result.errors;
  }

  return result;
}



export function compileTestContract(fileName) {
  const filePath = path.join(__dirname, 'tests', 'testFixture', fileName)
  const out = path.join(__dirname, 'tests', 'out')
  if (!existsSync(out)) {
      mkdirSync(out)
  }
  const result = compileContractImpl(filePath, {
    out: out
  });
  if (result.errors.length > 0) {
    console.log(`Compile contract ${filePath} fail: `, result.errors)
    throw result.errors;
  }

  return result;
}

export function loadDesc(fileName) {
  let filePath = '';
  if(!fileName.endsWith(".json")) {
    filePath = path.join(__dirname, `out/${fileName}_desc.json`);
    if (!existsSync(filePath)) {
      filePath = path.join(__dirname, `out/${fileName}_debug_desc.json`);
    }
  } else {
    filePath = path.join(__dirname, `out/${fileName}`);
  }

  if (!existsSync(filePath)) {
    throw new Error(`Description file ${filePath} not exist!\nIf You already run 'npm run watch', maybe fix the compile error first!`)
  }
  return JSON.parse(readFileSync(filePath).toString());
}

export function showError(error) {
  // Error
  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    console.log('Failed - StatusCodeError: ' + error.response.status + ' - "' + error.response.data + '"');
    // console.log(error.response.headers);
  } else if (error.request) {
    // The request was made but no response was received
    // `error.request` is an instance of XMLHttpRequest in the
    // browser and an instance of
    // http.ClientRequest in node.js
    console.log(error.request);
  } else {
    // Something happened in setting up the request that triggered an Error
    console.log('Error:', error.message);
    if (error.context) {
      console.log(error.context);
    }
  }
};

export function padLeadingZero(hex, byteslen = 0) {
  if(byteslen > 0) {
    if(hex.length < byteslen * 2) {
      return "0".repeat(byteslen * 2 - hex.length) + hex
    }
  }
  if(hex.length % 2 === 0) return hex;
  return "0" + hex;
}

// fixLowS increments the first input's sequence number until the sig hash is safe for low s.
export function fixLowS(tx, lockingScript, inputSatoshis, inputIndex) {
  for (i=0;i<25;i++) {
    const preimage = getPreimage(tx, lockingScript, inputSatoshis, inputIndex);
    const sighash = bsv.crypto.Hash.sha256sha256(Buffer.from(toHex(preimage), 'hex'));
    const msb = sighash.readUInt8();
    if (msb < MSB_THRESHOLD) {
      return;
    }
    tx.inputs[0].sequenceNumber++;
  }
}

// checkLowS returns true if the sig hash is safe for low s.
export function checkLowS(tx, lockingScript, inputSatoshis, inputIndex) {
  const preimage = getPreimage(tx, lockingScript, inputSatoshis, inputIndex);
  const sighash = bsv.crypto.Hash.sha256sha256(Buffer.from(toHex(preimage), 'hex'));
  const msb = sighash.readUInt8();
  return (msb < MSB_THRESHOLD);
}


export const sleep = async(seconds) => {
  return new Promise((resolve) => {
     setTimeout(() => {
        resolve();
     }, seconds * 1000);
  })
}

export async function deployContract(contract, amount) {
//   const { privateKey } = require('privateKey');
  const address = privateKey.toAddress()
  const tx = new bsv.Transaction()
  
  tx.from(await fetchUtxos(address))
  .addOutput(new bsv.Transaction.Output({
    script: contract.lockingScript,
    satoshis: amount,
  }))
  .change(address)
  .sign(privateKey)

  await sendTx(tx)
  return tx
}

export const metaFlag = '4d455441';
export async function createMetaNetRootNode(root) {
  const { privateKey } = require('./privateKey');
  const address = privateKey.toAddress()
  const tx = new bsv.Transaction()
  
  tx.from(await fetchUtxos(address))
  .addOutput(new bsv.Transaction.Output({
    script: bsv.Script.fromASM(`OP_0 OP_RETURN ${metaFlag} ${root} 0000000000000000000000000000000000000000000000000000000000000000`),
    satoshis: 0,
  }))
  .change(address)
  .sign(privateKey)

  await sendTx(tx)
  return tx
}


export async function createMetaNetNode(privateKey, node, txid, contract, contractAmount) {
  const address = privateKey.toAddress()
  const tx = new bsv.Transaction()
  
  tx.from(await fetchUtxos(address))
  .addOutput(new bsv.Transaction.Output({
    script: bsv.Script.fromASM(`OP_0 OP_RETURN ${metaFlag} ${node} ${txid}`),
    satoshis: 0,
  }))
  .addOutput(
    new bsv.Transaction.Output({
      script: contract.lockingScript,
      satoshis: contractAmount,
    })
  )
  .change(address)
  .sign(privateKey)

  await sendTx(tx)
  return tx
}

//create an input spending from prevTx's output, with empty script
export function createInputFromPrevTx(tx, outputIndex) {
  const outputIdx = outputIndex || 0
  return new bsv.Transaction.Input({
    prevTxId: tx.id,
    outputIndex: outputIdx,
    script: new bsv.Script(), // placeholder
    output: tx.outputs[outputIdx]
  })
}


export async function fetchUtxos(address) {
  // step 1: fetch utxos
  let {
    data: utxos
  } = await axios.get(`${API_PREFIX}/address/${address}/unspent`)

  return utxos.map((utxo) => ({
    txId: utxo.tx_hash,
    outputIndex: utxo.tx_pos,
    satoshis: utxo.value,
    script: bsv.Script.buildPublicKeyHashOut(address).toHex(),
  }))
}

export const emptyPublicKey = '000000000000000000000000000000000000000000000000000000000000000000'

export function toLittleIndian(hexstr) {
  return reverseEndian(hexstr)
}

export function toBigIndian(hexstr) {
  return reverseEndian(hexstr)
}

export function uint32Tobin(d) {
  var s = (+d).toString(16);
  if(s.length < 4) {
      s = '0' + s;
  }
  return toLittleIndian(s);
}

export function num2hex(d, padding) {
  var s = Number(d).toString(16);
  // add padding if needed.
  while (s.length < padding) {
      s = "0" + s;
  }
  return s;
}



/**
 * inspired by : https://bigishdata.com/2017/11/13/how-to-build-a-blockchain-part-4-1-bitcoin-proof-of-work-difficulty-explained/
 * @param {*} bitsHex bits of block header, in big endian
 * @returns a target number 
 */
export function toTarget(bitsHex) {
  const shift = bitsHex.substr(0, 2);
  const exponent = parseInt(shift, 16);
  const value = bitsHex.substr(2, bitsHex.length);
  const coefficient = parseInt(value, 16);
  const target = coefficient * 2 ** (8 * (exponent - 3));
  return BigInt(target);
}

/**
* convert pool difficulty to a target number 
* @param {*}  difficulty which can fetch by api https://api.whatsonchain.com/v1/bsv/<network>/chain/info
* @returns target
*/
export function pdiff2Target(difficulty) {
  if (typeof difficulty === 'number') {
      difficulty = BigInt(Math.floor(difficulty))
  }

  return BigInt(toTarget("1d00ffff") / difficulty);
}


// serialize Header to get raw header
export function serializeHeader(header) {
  return uint32Tobin(header.version)
      + toLittleIndian(header.previousblockhash)
      + toLittleIndian(header.merkleroot)
      + uint32Tobin(header.time)
      + toLittleIndian(header.bits)
      + uint32Tobin(header.nonce)
}

export function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}

// compileContract('upload_data.scrypt');
deployContract('upload_data.scrypt', new Int(5000));