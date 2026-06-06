const crypto = require('crypto');
const https = require('https');

const DATASET_ID = '891673903214904';
const ACCESS_TOKEN = 'EAAUiVZB4mEwkBRTppsIYEHmKgl88YHKEGxQVZB0RacxXPkmo8ZB8pvakpWIvZADZBC7SeF6ukZBvP575lEtFOAct7HEN0YqtmAy4cxgxGLmmFIIKEjIdTp4XJsjsZAoxzw5z0j9t6YSskAkZA19HzxiBxDBWFDhb3ZCZAL1ug3gw6Kf1OYMoMawkP8JXipYT1I8QZDZD';
const PAGE_ID = '152908757899058';

const sha256 = v => crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

function parseColombiaDate(s) {
  const m = s.match(/(\d+)\/(\d+)\/(\d+),\s+(\d+):(\d+):(\d+)\s+(a\. m\.|p\. m\.)/);
  if (!m) throw new Error('fecha invalida: ' + s);
  let [, d, mo, y, h, mi, se, ap] = m;
  h = parseInt(h);
  if (ap.includes('p') && h !== 12) h += 12;
  if (ap.includes('a') && h === 12) h = 0;
  return Math.floor(Date.UTC(+y, +mo-1, +d, h+5, +mi, +se) / 1000);
}

function firstName(n) {
  if (!n) return null;
  const w = n.replace(/[^\p{L}\s]/gu,' ').trim().split(/\s+/).find(p => /^\p{L}{2,}$/u.test(p));
  return w ? w.toLowerCase() : null;
}

// [fecha, telefono, nombre, pack, monto, email, ctwa_clid]
const sales = [
  // ===== 25 MAYO =====
  ['25/5/2026, 12:02:28 a. m.','573154349259','🐥🐣','diamante',15000,'marcelujan2602@gmail.com',null],
  ['25/5/2026, 6:16:21 a. m.','573217393467','Gramitos','basico',5000,'rudasmarcela94@gmail.com','AfjfuYW4v-IFnpWFHk90xsSfwiUKbaber4ThtEOojnXbin-NNOseGzlrtv8FynO-VcZKucuxVmJkcRChDT8gmsvc81UgWO5JAasZhNBCSbozi98yWHziVNdUhvG0IqXIVyPNkv7b-Q'],
  ['25/5/2026, 7:16:00 a. m.','573107661908','Danny Moncada','oro',10000,'andamope29@gmail.com',null],
  ['25/5/2026, 7:36:50 a. m.','573104029389','Esmeralda','basico',5000,'esmeralda10galindez04@gmail.com','AfgDCoEOz3EdWVvCAiVxOwkwbxeAEh_hfOoTHCU7LSN-GEwjKpXy3BWreSZpBCSzSlUqFSo_sWdWiA0hEs-8oqN2xr6o-L2dfQ93mzoQHzpSMuKGetWYhNtocrjHmk1MLp53P3o7-w'],
  ['25/5/2026, 7:39:08 a. m.','573236429589','yinecita galindo05','diamante',15000,'yinecita.galindo05@gmail.com','Afg2gE3YSwhWe0bdRlknnzHZ9CzDLddefpUPQWDlU9b5x0WBj-F4vZG0_9RfFkG_cPy68EPzZkV1MlHLzUEEYs8c4pZaGlgFQykgqv5abg6Z3SPilftZCPpYqZE9_7me106MlSKTVQ'],
  ['25/5/2026, 8:17:52 a. m.','573134264032','Nicole Cofles','diamante',15000,'nicolecofles44@gmail.com','AfjvnVEyNEVvgqhz1v0SFn-EaxXT1QFH46Pcyg2dywhLlLUvK7KimlKcU6mxH_66pT7QM0lt2pUOnGnnBLVhKLqusF5M92ZIJF_sJIivHJ7-zb9THl_m0HsIbXI_QJeQ9dS8Eo9RkQ'],
  ['25/5/2026, 8:55:42 a. m.','573144467104','Majo','oro',10000,'mariajoselopezforero70@gmail.com','AfhxjvuwqRu-LSXNQJYB1V5zYcuY_RJuQ0AC2UfGbuob-zeK7WZbKEPN6xY1T7xCQXn9t75jqbcGOEA_psCYrKsIjqAyYBqY7-7v-qJWn-PfdyivlnwKkCnG64AUEXP-m3PQSTYyog'],
  ['25/5/2026, 9:17:57 a. m.','573017429742','Kelly','diamante',15000,'kjpm816@gmail.com','Afhs5ecSZ4cnuC7EPXyCPPLe3vX4M2QEn5Q4IEsI9ce8eZI8ayqjm1DSCYFSYJddv8pk5ppDlpsAqoG1q7ofyFfxWvs9eOls3Q6z_YAZiWE_XRdxpBopk77W1Xkc8H68-bfJrSCLYw'],
  ['25/5/2026, 9:56:36 a. m.','573137569455','Urzolavivi','oro',10000,'urzolaviviana4@gmail.com',null],
  ['25/5/2026, 10:27:00 a. m.','573185009230','Liliana','basico',5000,'lilianamoralesguz@gmail.com',null],
  ['25/5/2026, 11:09:10 a. m.','573223890475','jchr','diamante',15000,'jchr2205@gmail.com',null],
  ['25/5/2026, 11:10:36 a. m.','573002005468','Natalia Castro','basico',5000,'natycastroanaya1997@gmail.com','AfhTUrnrp_cAIxe9N50QXBPoaPLeMxxFdNrT1Kv1lTWgMaFXfydlAUu-dKAAPMMrW9cVIPHcj1ivDLRxe84GTuej2VdcHUViIJ5ktF0RF9M56hxCBxWy9mss8TgDwbl9c07Nd_ePTw'],
  ['25/5/2026, 11:51:01 a. m.','573206982974','Yaina Mejia','diamante',15000,'yainamejia4@gmail.com','AfivrRKEfUmMocLo9Kayr9_hmgcVSIOdV3fxzCrpXnZ6qMH0pUctHXwa7dUuVpJ63t-7mWAyFSqyq6v5fAqrunpOLqtZrmrx2inSTHy-83m4IGfrOf9Shx1ETTd7fawh6yDUA-LeucKg'],
  ['25/5/2026, 12:18:56 p. m.','573142951302','Johana Pedraza','diamante',15000,'johanapedraza012@gmail.com',null],
  ['25/5/2026, 12:24:05 p. m.','573057984933','RodCris','basico',5000,'jennycristina.28@gmail.com',null],
  ['25/5/2026, 12:26:20 p. m.','573112563803','Helen P','oro',10000,'perezgeraldine2017@gmail.com','Afg1ocXWxT5R1TOCSm_eNCa2pHiqCNwuQMoNCAvCkaefJTUGrHAYDoLkf7lq_SGl_hpLECbMEjYOLunFr_aJv1WGjp-jo_Y9ftBAqwsv2Qer2kDXxW1XDzZQul3D61fjoZr6fY-uUA'],
  ['25/5/2026, 1:23:29 p. m.','573009087627','Vaaal','diamante',15000,'val.mg0690@gmail.com','Afgu84h1MBAzlGHRUM8jSa-IqZi-S9UtwarY0jomUCWMgRv5k8bfWyoxlQM1pp-4KYsJNWoCQl6NWDUoIdrK1fgz0wGvomPPpK85xfar1WUabU6Gzrui_Cr4iwTxQGXgflZmMn62LA'],
  ['25/5/2026, 1:23:51 p. m.','573123523427','DACARIBE','diamante',15000,'dacaribe@gmail.com',null],
  ['25/5/2026, 1:33:12 p. m.','573161640868','Mary','diamante',15000,'marianagiraldo8112@gmail.com',null],
  ['25/5/2026, 1:51:34 p. m.','573214463784','Gina Lozada','diamante',15000,'ginalove150691@gmail.com',null],
  ['25/5/2026, 4:04:02 p. m.','573244960551','Dani','diamante',15000,'bermudezd491@gmail.com',null],
  ['25/5/2026, 5:19:50 p. m.','573142100629','Johanna Rojas','basico',5000,'ingridjuanaguevara@gmail.com',null],
  ['25/5/2026, 6:57:46 p. m.','573161629622','nayerlis','diamante',15000,'nayerlisnunez0@gmail.com','AfirTPE4nGST-cWVpIB8jZYsMrqnGtJSIJg9g-RmWFjm-C88hQS_6LQMs82JG8sIiFtT1SLvk7mUjCNuHn_QiKn94QFZje5xfYPnhtFi3zg-OdACTFQej6N2DI9W-9XJlxHoSAPXdw'],
  ['25/5/2026, 8:50:20 p. m.','573014143628','Maritza Cuellar','diamante',15000,'maritzacuellar1508@gmail.com','AfgMm225ApZQXkqgCt8_B-LNHqYT8bJ9gAPSwWkHm5Kh0z3SIX4F4WAK06-W8zjRZlhDqz-wUp2Y8P7a9J9dAChwT20yTq32ImTmJKTQJtFDdX9b_7Beso3KzHcqNowKN1Y'],
  ['25/5/2026, 9:35:53 p. m.','573105606349','Tatiana Valero','diamante',15000,'tatianavalero92@gmail.com','AfiLeueVaWEsBSMtuk9iLOml5798Yy7EfeKjv-do7Prm_ScLN9yRwTtr7NsLpxYQQmeAACnkcOv0LiO8-DAVmMIAUb9Yj1AABmC6vyO-y2sLv09iqHDm4WOo5xxMKLGTYGlEJBwFVg'],
  ['25/5/2026, 9:43:53 p. m.','573332755775','Mary Guzman','basico',5000,'malejaguzmang16@gmail.com',null],
  // ===== 26 MAYO =====
  ['26/5/2026, 6:50:04 a. m.','573113666750','Leydy Pantoja','diamante',15000,'dpantoja649@gmail.com','AfidypXM9KWdyofwOhO_VEs6DiOJZ9eQ2PHGFh0rvrDYSoepcMo28zQUb-nlMJZxFFEdbS3ZfyM-944jvUKxCnOkjdlxg7F0fILOd7Hdtm8Fg1hudi5_XiHq7tjJ1ot65hv_V-zcyA'],
  ['26/5/2026, 7:06:06 a. m.','573142576978','Riano','basico',5000,'griano298@gmail.com',null],
  ['26/5/2026, 7:30:53 a. m.','573103616825','Alejandra','basico',5000,'alejandrapantoja@gmail.com','Afhz2WnjOh8bWKQsjyllI9wCZR_n_Bvz94m7deC22HjHxaiQMo8XpypeE18k-wSx6Tg7LSa95XgF-ZAmedZnzpL8vhxL0juv642hVY5icMDWhN2IJxP9RwgBKAmPfyzGXosF1oRSoA'],
  ['26/5/2026, 7:32:25 a. m.','573233849512','Ivonne Acosta','oro',10000,'ivonnedelarans@gmail.com','AfhYL50KTaxxoJmhppVSfwwUXrpyTCLhamxxOR04LKC94jJSKor4XiHBJWecMGmmmfyf7K6i7XYGTwt4Rm7QwuZ_9jH6WE8J3vmJNf1Ngfsur_zOe6mGHaXd-mGNQ1-739k'],
  ['26/5/2026, 7:38:24 a. m.','573124339490','Diana Mar','diamante',15000,'dianamar59@gmail.com','Afi1XJHiAiBjdP-OEO2Ojynpro1HU7mZFSvzSd-jwQ4a8bQVMNiMuCTcCZYNt4kluymwe_CgNktD_5imrrgL_aV8hLxbnJFjTEwviTFW_cLJ8bLrW2NbQe5iO1dSE8RmRu9wX4xct62q'],
  ['26/5/2026, 7:55:57 a. m.','573028002043','Noemy Rosh','basico',5000,'nohemyrosh@gmail.com','AfifPMYW-Lv5j-03QdswPZR8QfSJhOFW-IyOTyi02287tqN0sLBcsixJNYWLb9Rs57y0DuPCfy8j624rNPssAjz1jvACK_881xWcFmCX9qCsnI-bUkoUvGNC8n14NikqvTy45UU6Wg'],
  ['26/5/2026, 7:57:43 a. m.','573127011087','Andrea Munoz','basico',5000,'sayanaandreaandrademunos@gmail.com','AfiPNvWTukbo9D3IGjpT4pnu6Y0ci8l8rO_etuErigjMqcBtihgUb5lIBgOlkm2kx78Dwi2aOcSDA7Q-s5s83lAM67HE6TglupxH7GhTHsUPCGcN9rvNB1KkYOLmH91VNsvNPm59Og'],
  ['26/5/2026, 8:46:12 a. m.','573247925006','mariaro','diamante',15000,'mariaro97.516@gmail.com','Afh8COiDgohC66OukqiI68-nV2tDiB9tMybCGitqsPvdJQxzLm1XRey5Yb5ShhLG5-JiM6X26v4CDa2bNC0uhsh4h8Dts_k3DpO3IZqQZwItxG0GKmWFvBFOxyAdDnV5g3xRpDUdCQ'],
  ['26/5/2026, 9:11:28 a. m.','573103359125','Liliana Sierra','oro',10000,'liliana8507@gmail.com','AfiqRdovYO3FsafXuzJ47BxsL2LpIIhGsIZeCokhjHOknK3N9m1m9vhzqfzkbU8LgvA3Ek1TcfhUlHG0eU7YYrkPXetVE6Q9fz28NPcU4bIVdpG6IITGNzWREJ6_WMRyXA'],
  ['26/5/2026, 9:33:36 a. m.','573044487098','nathycm','diamante',15000,'nathycm6@gmail.com','AfhECyZyWljdPqwZAGnFtStAC16Gk-11F1BWhJNADDsPZCW66-GAfPi3rszN8dfqa3p0accYr6rAr8MqUwG8Q4QnNtr24PgQOGEhB6MxubQRAaMhHWF4HXT73wFmd7UHi3w'],
  ['26/5/2026, 9:37:37 a. m.','573054319421','tjessi252','diamante',15000,'ctatiana1252@gmail.com',null],
  ['26/5/2026, 9:39:57 a. m.','573006955530','Pili Gm','diamante',15000,'pilargm80@gmail.com','AfgZWdb4Q_cNstt4p95Mv2-slpKAzRtCAyIfECPE3SFyVY8y6miTj5ARNrcu3CwpWRiNZjnZxh2Yw_oAXhaSQ-HcIsoJOTssk0OH_dDGVr6sLNbLOQPYwqDsurKGUrYZiS98aiSt1g'],
  ['26/5/2026, 9:49:34 a. m.','573166648946','Elvia','basico',5000,'elyrodede27@gmail.com','AfhV2FhebXT7XHK0WvRR9qW1j4B2Sq8JSn-8CS5P_KVFnhEAl5FzmWP5tDonx4ysAgGYTH3XJw6_-Tl8_LcN98T_ke8dDNRjOwgOqVomcAVqzHWxgLXLp-xxqj4tV83ZlTHMdd_O'],
  ['26/5/2026, 9:58:57 a. m.','573104508942','Sandra Meneses','oro',10000,'sandritamen1123@gmail.com','AfjJJbTl_TiHSSw0L4-3VFSz9zfc-74vQoDFTeAFEP6VFOrtBC3zePmu1RSBzNJA_9gVB64VjKIrImRClEw1EIifKm9UDVCnpJpnehyHJnbg9wTWXqLHg9PB_5LyQYYspZ2aF4LLDg'],
  ['26/5/2026, 10:04:13 a. m.','573207148936','Isabella','oro',10000,'restrepofrancoisabella7@gmail.com',null],
  ['26/5/2026, 10:24:06 a. m.','573183801546','liparra','oro',10000,'liparra9@gmail.com',null],
  ['26/5/2026, 10:45:47 a. m.','573178812912','mayjhon','basico',5000,'mayjhoncami@gmail.com','AfjPGcyMQq9PlmaLkfgGlQi-_XoZDCWo2ipNCJhteGAeryl7ko0g_osczZZYkZELkBjifBnoU9NlAJSFWG0P1Gp7cFfieBL_VeCMDUe55vvBcPYz1qhX_fTm3AM10IqyKSFRXOFzMA'],
  ['26/5/2026, 10:59:01 a. m.','573143306009','Pilis','diamante',15000,'pilismaria1138@gmail.com','Afj3oPuIWiNsTP4mHAIwd8JTz7XtJVeh-eVDmbYyqfw_rzRpxOrBFeqho0LWEUxUD6K7qWJTHAhiZqHM4z4ENsYRYWFSZaHrFxc-rEDu0Go1n4v0qJ-QlsdvuBayJA9yJ54K4-uHw'],
  ['26/5/2026, 11:16:26 a. m.','18623491754','Karol','diamante',15000,'salamancakarito3@gmail.com','Afg0DGG2JuKlkiBb-L5ouKQQCo2sXSHZZTlz-1t2ADxb70WhyJgbTZRGNS6HABFLbRRjsg9iMKf7vJsO-0RIH67k-GjMKKbfbX0eSoEK-ldris6V9cjIAtXsPzYygDeVj_KL1Drkgg'],
  ['26/5/2026, 12:34:05 p. m.','573004404590','Liliana Velasquez','diamante',15000,'lilianavelasquez1005@gmail.com',null],
  ['26/5/2026, 12:53:47 p. m.','573208788404','Yiseth','oro',10000,'yisethxdhoyos@gmail.com',null],
  ['26/5/2026, 2:31:43 p. m.','573223957953','Juanita','diamante',15000,'juanita.alva2006@gmail.com','AfjmSm65WMl7dY_SmEI4X0hs7L2ka-326Bvj-I7edO5kBzuLzOR6t_bAyaFcTNVdB8omrSs-QbXJfx06wVvw1Z7B3UJmMhtPC2dV0EW7Mol20CUe2X8u5pTOPmrBPu0YPvRf4YArmg'],
  ['26/5/2026, 2:51:07 p. m.','573214849851','patico','diamante',15000,'paticobermudez2501@gmail.com','AfjOz3jvayRBosRbIqTiKs_1s_sqxufaP4jknpAo27bQoUmR2p1zz1-9aa6JYImHQmGGED404AaEKhntyFXCeZLqXcHA6rsVV0xp44TaMf2v2czI04wVpDDjigXT9_thj5KemhKyCw'],
  ['26/5/2026, 3:44:29 p. m.','573137395342','Zharick','diamante',15000,'zharickvargasacevedo@gmail.com','AfhQJH1mAQr47_cnljA3JmidnTfeucmYG53o8HYa8cLzRExv6jNxZUq2kWijwREnOmSzUtVzQA_6v3_I-AG-cFk12pmMWuTHtSUvLFVfFL2-0Qdz6hVXv7IO8y3zgdS6ED-vPnCGdQ'],
  ['26/5/2026, 5:08:44 p. m.','573213945753','Martha','diamante',15000,'marthahelenagonzalezestevez@gmail.com','AfjrEpyMJWCdPfKmln__qk5TkIoPpkQiD_J6f-nyvCk8uckLFU7oPoVLMeeG0fVRsPSlQS0sV2umHCwwMhZAANmdqPc-jPnGBOZ2MtWhjNOYyp1Fn0yDgqZJiDju5ERb4ya9Uwkd171y'],
  ['26/5/2026, 5:39:59 p. m.','573228804752','Lore','oro',10000,'romancelina09@gmail.com','Afiv2b-qCB3CW0XkAwClUZJpDSfjwCBh_6MHG02aqvUv57sipD_AekMJ4hp1P9Cj6q4nozuX_yiOyjMme-iKeFGKZtmcN4ZcZ4OlB0IoNTzgQDPMTEun3t0-qUfW0g11MLIoRQrf'],
  ['26/5/2026, 7:33:58 p. m.','573212542938','Ana','basico',5000,'anatrozo88@gmail.com','AfgDgxo9p9oXlehD5CD7WsNR3BfSMfeqXRSPss1hUANhL7qrGp61lHFgelAwxo3pQtIDpG5QeapzmOTuqNWOb1GmQ15RBPzxp5upbO5puhTNXBfVjXFQTKb_djANncZ2v-UfB2cMww'],
  ['26/5/2026, 9:25:51 p. m.','573202742986','Joha GC','diamante',15000,'polaminino@gmail.com','Afji0HPLmtChsP0o4t-Y54RNhI3EhEf-G8Jp5FpitzB1SHdDIzBQPI8jIfpHjtOM00GFwGBvX4PNwDAJcKHeOKBnU-g1jh0imI24PmWqgDxvJWeaaPm-IS4WumRA-2LK_Rs'],
  // ===== 27 MAYO =====
  ['27/5/2026, 6:52:45 a. m.','573206194121','Naniis','basico',5000,'compucellc560@gmail.com','AfjsPymQjtgRoduKjcLjRrR0BWq-ftM0k8EdgK-8rzYQAknlwKOCA-qTBVxXn4DUYxIlF29ztglBQjfDgTpvcbDy3wclLDk87S1BpdPWLtzxJJGUgQl0GbC6fGinMYPVLnJiNQPWCA'],
  ['27/5/2026, 7:17:01 a. m.','573175272812','Tefa Varela','diamante',15000,'tefalopez156@gmail.com',null],
  ['27/5/2026, 7:38:27 a. m.','573138067776','Tatiana','diamante',15000,'elmundodefeli63@gmail.com',null],
  ['27/5/2026, 7:45:35 a. m.','573187793170','Bibiana','basico',5000,'bibianagarzonmeneses@gmail.com','Afi3JI1e6zC-U9PfJqfpqQ6fz7abqXoLxVzDBsQzLQwdsZRB_6hurIMjwfqPj3lgt2UbRpnSmnlFPqQ29qJGYMMBKmuqReZPujM4yopDrjtWNe0FIBt0GTn6tYf99k8r_uJkbfU2vg'],
  ['27/5/2026, 8:32:13 a. m.','573234663092','Leidy Garcia','diamante',15000,'leidygarcia2511@gmail.com',null],
  ['27/5/2026, 8:36:39 a. m.','573244454797','Yulissa','diamante',15000,'atenciayulissa@gmail.com','AfiS7RcnTyCEB5XsL9uEumX2TrBkjTZEz9A7TOqdH67Fmfkwv-7eDQ-WYQINIhU0vQhUFF1IL2LhFIX0a1pR6BAf7mYlmqmS1NFVneysZhCM7c9RnTrF8XueVtfyFvTxMPrVSyoICw'],
  ['27/5/2026, 8:57:54 a. m.','573225769245','Sofia P','basico',5000,'sofiapelaez2020@gmail.com','Afh8hFBBL1v0QlHzXYfIcI1o2MILxWHCKQrlFPEk-KXrPYMe3E6EgvNg-AW3cLcAZpYj4YnTWH9tSEeMuY5i5geWiROx_7Ws6lVkNosQZlTNeHqyeEn9y8qjit5kGB5Opzy_6WGYtQ'],
  ['27/5/2026, 9:05:39 a. m.','573106894266','Giselle Pineda','diamante',15000,'juaca44@gmail.com','AfhRizXZU5iYyy7pFu7nxqeeF5nfgtvQ-InnifMys8miuQe_ia0m0iHjf3F4RLQPqhEZpEjOcyK6xWeYtq3EEbjPgSHridM4x-GYTkJfkT_FYcvT4hPjLJKerjgjTgoEAMrBopJxRw'],
  ['27/5/2026, 9:28:09 a. m.','573214571558','Martha','basico',5000,'acevedomarlucia@gmail.com','AfjM_1fR6jegLLs6YR0Ohc2DK3YgBeGGZakXpM0sQ8S15V0I0roWZt9ZfyEqohRBguLkMAGQbGtIzGlcAqDrMFLgri3-fG3s79DY6WiTZu2Rd6VzqON4MgTsqryzRyV3P8lfn2ccng'],
  ['27/5/2026, 9:28:48 a. m.','573108154945','paola salguedop','oro',10000,'paola.salguedop@gmail.com',null],
  ['27/5/2026, 10:05:03 a. m.','573107597989','Alix','basico',5000,'yolandaramirez290916@gmail.com',null],
  ['27/5/2026, 10:07:59 a. m.','573103009121','Andrea','diamante',15000,'andrutrs.25@gmail.com',null],
  ['27/5/2026, 10:19:20 a. m.','573208022293','Milena','diamante',15000,'milenarincon1217@gmail.com',null],
  ['27/5/2026, 11:36:12 a. m.','573137048346','Ale','diamante',15000,'tabordaalexandra326@gmail.com','AfgXiyVlTwuNBThriCLkFdO5h3dg3XNPeti-A1vDGyRSE1tJ5uhhVCC5nMjZyoiV0ZW7tsvw5g_BkEznBAq_xIir9Unc0cYB0WpfTrWOZBrXhb7J6u0MoWuTpzDe8oiYZeLMT6HD7g'],
  ['27/5/2026, 11:41:46 a. m.','573002909933','Vale','diamante',15000,'valeetorres2006@gmail.com',null],
  ['27/5/2026, 1:06:55 p. m.','573144551632','Andrea','diamante',15000,'monteroandrea363@gmail.com',null],
  ['27/5/2026, 1:40:30 p. m.','573106170574','Laura','diamante',15000,'camaronduranlauragisella@gmail.com',null],
  ['27/5/2026, 2:56:26 p. m.','573215732523','Juliana Rivas','diamante',15000,'rivasheidy549@gmail.com',null],
  ['27/5/2026, 3:54:48 p. m.','573053827248','Angie Sarmiento','diamante',15000,'angiesarmiento@gmail.com','AfjhNuXq9YBY6hifBnZ3XDZqmnMqrhW7dO6GPqvFsuyL_EvXNrvRvA6CnR9i8oEfKbgEwJxSff_RlFayUeA1wms6kO4GZgG0BVt-QYf95C8hj6IrpA4twrhDkT_pKKhy-dBUQ-Bkjg'],
  ['27/5/2026, 4:50:05 p. m.','573181284987','Petalu','basico',5000,'lauraserrano199516@gmail.com','Afg1_0fVToEdKsaMrt4mp6nTdtYWq6rYlP708eRciCY3-yPy96JZ4wd8QGUo4fRzFAL9feumLsNDlgRBg534-XxBaQRgKOe_L4wTrB69258ap6_OUGuDdtFrbKyFOVfez4VFeTUD'],
  ['27/5/2026, 4:51:39 p. m.','573122974720','Fernanda','oro',10000,'lucyreina72@gmail.com','AffYorrj6ga8nqvD_YCq3nT59c1nOEaA3hirLlq4yODJpMGkMfeSjJChXr_Ulj-v1ZJyug0X7N9KVakmjemV1sYEKqYeQxIdIcArsRCDfW_3Zj2LszN88RX-PDVWL3yoaqh9GgGFyw'],
  ['27/5/2026, 5:43:39 p. m.','573219164987','Yiseth Munoz','basico',5000,'m9yiseth@gmail.com','AfgL_u8zf1oy_QkrtdCUV8CvMHUDA4N0aV0D1aJQ7Wlv1VttL03yTVsFOKe5kRXjemKxs-j-IyYsdGXaoFtwKzTLcvzYcqpgKqp_JprnKsNLs6-3BG2TOmUkSo3mf3t7kb1YnrMeIA'],
  ['27/5/2026, 6:14:27 p. m.','573144072118','Kelly Tatiana','oro',10000,'orjuelalopezkellytatiana@gmail.com',null],
  ['27/5/2026, 8:10:53 p. m.','573118629452','Alejandra Castillo','diamante',15000,'alejita010490@gmail.com','AfhmccoK4DQmJHDiq5ZRNxd4kjzJGYq5ZnhWYsb2smiHjMDaar45Iw3Rfkm8xwzvBdL3eOua0xZzJwAvccC0P868t1i1mcgCUDP85BJBrObbSgrtKnpvC4ZV_5KMBVuof7Y'],
  ['27/5/2026, 8:17:27 p. m.','573114191983','campop','basico',5000,'campop91@gmail.com','Afgac1Vt2fbeicadzeR0PlINqLoU9LFOZdeB0nAgi7mTfkRp1G9r6EM9GHs7sZy1RFhmX8dyHwN4QwU6AjDNH2oojNIIOGpLq9c1Rbcxu2Y7iaDjLKslikxaEzYs4nobY3DGhQX9N3NM'],
  ['27/5/2026, 8:31:31 p. m.','573112006524','Yasmine Diaz','diamante',15000,'chiquitina1409@gmail.com','AfgAJAisM-hy5zUNmzwhf4_sUB2sEIoBeYYlATPYU2_T330jLcXY33ozl-CYnCtunsk7Orv2gBbCUPMgN6c1QGiFmPU9DX0xplEKskVJqwGkCOrvIDvcucf9oY2533OJU050z-54pA'],
  ['27/5/2026, 8:32:42 p. m.','573011431679','Saylis','basico',5000,'sayliskatianaibanez@gmail.com','AfjoI3UFiKB9yV3-oZpPj7M_Lg_zFqzwZUydvJ3_Fd-X2IpbiQJPphFcKU4Evf1y4iRpUdq_IJUODigXmkdDQJym9ogBW1R5DwZ3wV-MllAq__DBzmDl5FENlkQBU1QjZNV7x5owTw'],
  ['27/5/2026, 9:14:00 p. m.','573212574680','Nally Barbosa','diamante',15000,'nallybarbosaramirez@gmail.com',null],
  ['27/5/2026, 9:29:24 p. m.','573184912453','jmv','basico',5000,'jmv0206@gmail.com','AfjQPKrRSuLPSiIjVGocxVrbPXsBGbVD3jQAv9k4ydRk16F3fDVuvTKux8rDzekXHjoNIsvBIGLyvXiVR0pTSUwG4AHlia7Rd1vMAuDKzekXHjoNIsvBIGLyvXiVR0pTSUwG4'],
  ['27/5/2026, 9:30:53 p. m.','573125023677','Cami Floristeria','diamante',15000,'cg240995@gmail.com','Afh3VZmxd39RpOIKeiBXSxrKBGo7vbwWZYdD1a3BbXobxAfXZYKrme0cusSCShb4LUpR04nvVDEQpONfDM6ONofm1nOUil8qNaIqg9g6AbYxFKVEfYSsOf6MPkIBni7lqdifdDPS8g'],
  ['27/5/2026, 11:01:41 p. m.','573216250202','Heladeria Santi','diamante',15000,'distribuidorad.s219@gmail.com','Afj40h5vIUqHZlEwQqBu9jXyHfTao_WvIQSaT2BZ8Z3SLT3Q5MpfoG7-dvZMVf0ACV8RWMeQNslS6wZh5CYxOJH3WV2Da9qqFRR_YXD42R4KH1yKgV4DermU-RSfJX8iFUc3BgcZdA'],
  // ===== 28 MAYO =====
  ['28/5/2026, 6:13:16 a. m.','573226095188','Maria Camila Hortua','basico',5000,'mariacamilahortua19@gmail.com','Afi4cX9WHclhGyfGlEV5GCp3fmQkyrCyXpoupP7iKhkygLtY7gloKl0XY3t5GgmQ1ykLi2Ba-hibNjyFMZr72IB5I2NLgEGkhCZv4_dZzqNjOtnMuhRoB9TfW3p1g3HYU_C4zwDo'],
  ['28/5/2026, 7:12:34 a. m.','573187877279','Greys BP','diamante',15000,'greyzbp@gmail.com','AfirrlX0OxJn9AUGX6wQLfjAHFS6d_E31L2LhFIbe6rivNz5hxvQQkVg1pFrZo8J3zfkd8BJ7PQWd_CGvtvJq06m-dbvaV9s8mRYOIFNFi0SVYM-ymMKQGKcBBGGIOB5OfnPY58QIQ'],
  ['28/5/2026, 7:12:51 a. m.','573022344180','Valentina Ramirez','diamante',15000,'ramirezvaldesvalentina8@gmail.com',null],
  ['28/5/2026, 8:20:22 a. m.','573157290614','Diana Marcela','diamante',15000,'darce258@gmail.com','AfjtI6fOmsr0B891PCCNVFth4lpiZJLHM-559axnP4PySrl_HPZxdq00tNOdPz7Srbb9z3xcT26g_Q0KoCC0rKnXWW4csXpo-SPYGYarBMm1XUiLnYwmycohtJAI2ZuG4PM'],
  ['28/5/2026, 8:58:25 a. m.','573156993980','Valentina','diamante',15000,'mdeysivalentina10@gmail.com','AfhEmZ7NAn5hdCMqaZg52Xjm3RBVPPrAYRAmDM4PZppVlrygiM4FPFEACmF1N__Ggy8iAa_wfRdzSl3u_Y5QVjRpAgIL4QwEU0qK-MYBRA8M_wLCf4U3ua-TMNggGFimnkdNNLM8JQ'],
  ['28/5/2026, 9:08:00 a. m.','573025277541','Maritza','oro',10000,'maritzalorenamartinezlopez@gmail.com','Afhxpki6m0QKzbvCzLSurCENeCxiFnlKoUteJ-66FUUYzqpNZ-cty0yXwgLrSi7rB2vEpUM5YwFJ2ytpUWzgWrjJvJZCdyi-2TYGGybWjbfrrgRRGaxhHaFQx6XqSNNR-oG1RkLl6Q'],
  ['28/5/2026, 9:38:43 a. m.','573177411647','Cesar Hernandez','oro',10000,'julispacos@gmail.com','AfdVASS6UesZzS6EeZHjPQx2uWBxZLwzE31R-P3ggbXQ6Np5DAZQcSFmatJ2-Hu1OW44Zn5EMHOLJFKc_lJhuZCDwFf_mkwj7hNcPb5Wn1NDr36nboBCFTOudgGnrk4W8IL1P_yGSQ'],
  ['28/5/2026, 10:56:12 a. m.','573025481651','Adriana Ayala','diamante',15000,'adrianaayala2405@gmail.com',null],
  ['28/5/2026, 11:24:49 a. m.','573154394950','Yuliana','diamante',15000,'gfrancy708@gmail.com',null],
  ['28/5/2026, 12:59:50 p. m.','573004240770','Ma Victoria','diamante',15000,'oreosoto25@gmail.com','AfjNXw3Fyg6pDd3EoHQaZohb_j80J90yC__hzGFpCB05JWjCsdsoG3RAlGbww7j6FOQxxItdXZ13ILqNSniHTXqJnnafG0goCcV7e7HKioZuc4-cEm0CvbM5gezK6obleEAEyGhIOZE-'],
  ['28/5/2026, 2:47:26 p. m.','573189403817','Elena Gomez','basico',5000,'elena0423gomez@gmail.com','AfgZIGEjoZONCb5i5leYU6muw3cHZIOi5Uks4OCMKy4-slDHR3rPhQz5tfdt4CoX0eojNytm5k1fkby1182L4tRL4fScfkO12aqyI1oMUnw1G_WaIg9lvjt82X33K_3M--wT11PK'],
  ['28/5/2026, 6:56:16 p. m.','573045972264','Diamond Glow','diamante',15000,'nataliavalencia091@gmail.com','AfgOWrktDKTCDWUkQidZqTP5kV955wRuMoaSBGFRyPgMD_8FsH7pb1elotz28YHj1oD13XJjvWjhCXPnyMq5ExE5sJzkfcV4bbN3t5zYA8CjKSbXXfYdJBKBCevFbbzuoBarWWpwD_Ne'],
  ['28/5/2026, 8:10:59 p. m.','573118350726','Belki Alferez','diamante',15000,'cuentasjuancuentas@gmail.com',null],
  ['28/5/2026, 8:15:43 p. m.','573219160912','Heiny Aguilar','basico',5000,'heiaguilar03@gmail.com',null],
  ['28/5/2026, 8:20:57 p. m.','573128339005','carrascal','oro',10000,'gerstegabisa@gmail.com',null],
  ['28/5/2026, 8:30:47 p. m.','573052809810','mariadeleal28','basico',5000,'mariadeleal28@gmail.com',null],
  ['28/5/2026, 9:13:34 p. m.','573007590712','Diana','diamante',15000,'funda.lalinea@gmail.com',null],
  ['28/5/2026, 9:14:22 p. m.','573217182408','Fernanda Botero','diamante',15000,'fernandaboterocontadora@gmail.com',null],
  ['28/5/2026, 9:24:29 p. m.','573052158303','Zelena Celedon','diamante',15000,'zelenaceledon12@gmail.com',null],
  ['28/5/2026, 9:53:28 p. m.','573052821459','Valentina','oro',10000,'medinalola2529@gmail.com','AfhPpUUyXdizr15G10n-KROeINEhkYN-esr0Wpr1JVG89UqhEwd5JypNxoxC6Al_wGDKWEnr9LvSpN5WI1zBYV6wdc4-Yb3kv42a3ibaRv7Xn2AAPiciJa1cC7SptZzfsmoujJ-pMg'],
  ['28/5/2026, 10:08:59 p. m.','573232870737','Emily','oro',10000,'rouss7718@gmail.com',null],
  ['28/5/2026, 10:13:48 p. m.','573022952308','Yessii','basico',5000,'yehe061812@gmail.com',null],
  ['28/5/2026, 10:18:32 p. m.','573216052327','Diana Quiroga','oro',10000,'leonquirogadeisihaneth@gmail.com',null],
  ['28/5/2026, 10:38:35 p. m.','573005020272','Abigail Pautt','basico',5000,'apauttmendoza@gmail.com',null],
];

function buildEvent(row) {
  const [fecha, telefono, nombre, pack, monto, email, ctwa_clid] = row;
  const rawPhone = telefono.replace(/\D/g,'');
  const ud = {
    ph: [sha256(rawPhone)],
    external_id: [sha256(rawPhone)],
    page_id: PAGE_ID
  };
  if (email) ud.em = [sha256(email)];
  const fn = firstName(nombre);
  if (fn) ud.fn = [sha256(fn)];
  if (ctwa_clid) ud.ctwa_clid = ctwa_clid;

  const ts = parseColombiaDate(fecha);
  const base = {
    event_name: 'Purchase',
    event_time: ts,
    event_id: `retro_${rawPhone}_${ts}`,
    user_data: ud,
    custom_data: {
      currency: 'COP',
      value: monto,
      content_name: pack,
      content_type: 'product',
      content_ids: [pack],
      contents: [{ id: pack, quantity: 1 }]
    }
  };
  base.action_source = 'other';
  return base;
}

function postCAPI(events) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ data: events });
    const path = `/v21.0/${DATASET_ID}/events?access_token=${ACCESS_TOKEN}`;
    const req = https.request({
      hostname: 'graph.facebook.com',
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const events = sales.map(buildEvent);
  console.log(`Enviando ${events.length} eventos retroactivos al dataset WABA ${DATASET_ID}...`);

  // Enviar en lotes de 50
  const BATCH = 50;
  let ok = 0, errors = 0;
  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH);
    try {
      const r = await postCAPI(batch);
      const parsed = JSON.parse(r.body);
      if (parsed.events_received) {
        ok += parsed.events_received;
        console.log(`Lote ${Math.floor(i/BATCH)+1}: ${parsed.events_received} recibidos | fbtrace: ${parsed.fbtrace_id}`);
      } else {
        errors += batch.length;
        console.error(`Lote ${Math.floor(i/BATCH)+1} ERROR:`, r.body);
      }
    } catch(e) {
      errors += batch.length;
      console.error(`Lote ${Math.floor(i/BATCH)+1} EXCEPTION:`, e.message);
    }
    // pausa entre lotes
    if (i + BATCH < events.length) await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`\nRESUMEN: ${ok} eventos recibidos por Meta | ${errors} errores`);
}

main();
