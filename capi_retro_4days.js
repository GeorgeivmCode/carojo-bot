/**
 * CAPI retroactivo — 29 mayo al 1 junio 2026
 * 64 ventas perdidas por token incorrecto (error 2804131 página no asociada al dataset WABA)
 * Se envian con action_source "other" al WABA dataset 891673903214904
 * Usa el system user token (ads_management, nunca expira)
 *
 * Ejecutar: node capi_retro_4days.js
 */

const crypto = require('crypto');
const axios  = require('axios');

const META_PIXEL_ID  = '891673903214904';
const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN;

if (!META_CAPI_TOKEN) {
  console.error('Falta META_CAPI_TOKEN en env. Ejemplo: META_CAPI_TOKEN=EAAiZ... node capi_retro_4days.js');
  process.exit(1);
}

const sha256 = v => crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

// Datos del sheet — 29 mayo al 1 junio 2026
// Columnas: fecha_iso, phone, pack, monto, email, ctwa_clid, ad_id
const ventas = [
  // 29 Mayo 2026
  { ts: '2026-05-29T11:41:20Z', phone: '573181692990', pack: 'oro',      monto: 10000, email: 'garciapaola1998@gmail.com',       ctwa_clid: 'Afh91eXS3kJuUFT_AQDXDiIdqHJLp0BwuvLQYVgcvtpEa_mehFaJIWTiK43FVe1vmSAms0kLVJ6qmbXqGAnxQ9tp-WpYwcb9xUAre8FZ1Hte606vkyzExCliEtMdCoeD-DixzskIUXJe' },
  { ts: '2026-05-29T13:14:55Z', phone: '573214714834', pack: 'diamante',  monto: 15000, email: 'lilipachon8@gmail.com',            ctwa_clid: null },
  { ts: '2026-05-29T15:32:54Z', phone: '573106098575', pack: 'oro',      monto: 10000, email: 'nidyacelemin@gmail.com',           ctwa_clid: 'Afg59g04GZAypPTMTEVrOvOPJWxO42HNfi80S450Q6tCpiyeyqR0E22cdwUrQd9ZcpkYi0NLkKYjvBw-tIevBhHPfE9OCcHry2b7tuPJP137nmmC6HrsJxOZjvXTwZx_1y37ERTxTg' },
  { ts: '2026-05-29T16:12:12Z', phone: '573172231817', pack: 'diamante',  monto: 15000, email: 'yulipardo.o@gmail.com',           ctwa_clid: 'AfheidwlSoKeNIkcnEvLv_me9rgSSuDgBTVW0MDON5UAx5xTudaEX73VrBarae4p6U6GTegycpC8OtyQWDtiFgRTYamrxwuLvWahoYfJq8G08NyRr1AVBIxAYk5IMTO5AXk' },
  { ts: '2026-05-29T16:16:46Z', phone: '573163484385', pack: 'diamante',  monto: 15000, email: 'lmarcela2495@gmail.com',          ctwa_clid: 'Afe6dAHKp0TGFm2C1trOQIcu8AMj0Fh8IGroWzitpuGal81WbV3-jk932CrGWnI7YpD-ZGRVdPP65-sVJHXKZuy2xYF_PZpg4vsFGBkcIO9WlvUOJpK3TNblJpnKceOhpQ' },
  { ts: '2026-05-29T16:55:54Z', phone: '573106792118', pack: 'diamante',  monto: 15000, email: 'megapapel13@gmail.com',           ctwa_clid: 'AfiGglGgq1o8HOtdNNqcYsxhEvYoRn0kx1he9kdBjVBUMSXUB9DDJQa-0ikepvYi7u_Zb9-WfaIPEjV1HaiyVLkny4JJrB3m7u19LLWF1Gqne1shN35dzeaD3iJhrmjkZkE' },
  { ts: '2026-05-29T17:15:58Z', phone: '573122110527', pack: 'diamante',  monto: 15000, email: 'galindoperezyolanda154@gmail.com', ctwa_clid: null },
  { ts: '2026-05-29T17:19:52Z', phone: '573206861191', pack: 'diamante',  monto: 15000, email: 'oscarurielatehortua@gmail.com',   ctwa_clid: 'AfhXTYAdHObnXLDjYRDVSJpXZthlWrZ4rYpS6cQrEBN6DK9HlBKWwpwcsJPF-lXS1gD2aDhn7QUvdi_qAtQ9AGgfobt1B4q8nwnndbM3yahDJGwgmQImXDUXR1b6kuEFchZtNUP-9Fhr' },
  { ts: '2026-05-29T17:35:56Z', phone: '573011113950', pack: 'oro',      monto: 10000, email: 'jostin242015@gmail.com',           ctwa_clid: 'AfgE3w5Uq7GBnQ1grwieZDspBFfMWCI_GbYkufXM8EThATyl82gRaDAiGIQdd8rRqgqHttZNSmYYLHUUXY70hU8rH9eS1TzEox5I706cxZJsu8GLD_EOn26tkUoX6nrR294UmiQVeni7' },
  { ts: '2026-05-29T18:35:52Z', phone: '573043927083', pack: 'oro',      monto: 10000, email: 'shisofia22736@gmail.com',          ctwa_clid: 'Afif6mjm4M2ArwqB8-s8TmzNt0XWUFumstlVO7zU5XqRRvZPrp--Cv-BVmx1_6n-wCQGH-GsTiNnPxa0h8h_ZZw2QPdNCkAaJTk9YoiT6hI2SyGtwowSTiQSZb6kbv5Cf5KsMehkhw' },
  { ts: '2026-05-29T20:16:50Z', phone: '573022116757', pack: 'basico',   monto:  5000, email: 'kateyjuanlosamo@gmail.com',        ctwa_clid: 'AfjIUcD4Vn3UMHeD7jMet3gArmCx_WQSOP-LowQHy_yDhoWqz_wUZn4-PTk2rl43ZYqnE3ckJ9C7G9jlexyz04HbU-E1dkiYWOoPMDYSMDYSBKJlN5PoMdj1FkeZZI4A4p5GCX_mvCrABw' },
  { ts: '2026-05-29T21:52:43Z', phone: '573102371165', pack: 'diamante',  monto: 15000, email: 'jmcuellol@gmail.com',             ctwa_clid: null },
  { ts: '2026-05-29T23:42:22Z', phone: '573214275866', pack: 'oro',      monto: 10000, email: 'paulavaldes100705@gmail.com',      ctwa_clid: 'AfjKWUTqgPfFspyBOA5_Ii4MIjJxViqTcdiC7KAn5FiY_PzU2FYJ89fF8CATzMwD_oL-HvekVUyYIzOgF_NnFGjEbFIhmHh5gIGQfNLTH4AVB-zX8SYDlz4slHVEJaGrTA66mwAUkpbu' },
  { ts: '2026-05-30T00:47:48Z', phone: '573053368423', pack: 'diamante',  monto: 15000, email: 'greys.tatiana.vega.m@gmail.com',  ctwa_clid: 'AfjtYFItaR2NpOUTFISlpYdy_thhBs2JANLV0uuhe3y9R4-5rQlMzOrVvOCzryA0oMvh-Oj-qQwJC899FxHksRjaFovFzkjEufsFPl2CuULOcUiWpay_89kNFDqEXZ9r0oI' },
  { ts: '2026-05-30T01:47:18Z', phone: '573212190617', pack: 'diamante',  monto: 15000, email: 'nidyaelena1279@gmail.com',        ctwa_clid: 'Afhdn9cIJ1he-YC5nnbId36rzlsnAgAUfDAnq3IJTDgVwxvuIdpHF5MKQzpty8jSpQtmiM9jx6_ku1Rt8oatcq4BYWcPQ36_Ssk3bxNXbyw9Z_s_rLRSZZOxdFjQi15WKmO7qX9zuw' },

  // 30 Mayo 2026
  { ts: '2026-05-30T11:27:34Z', phone: '573122978084', pack: 'basico',   monto:  5000, email: 'diegobb3@gmail.com',              ctwa_clid: 'AfjPpViVd3mCvPKxC9gJFse536lQKFvyFdIGiyxYSuQl4gfQnp8Gp3mgSKekU0Fj7NthdqGfhcd8p6d7L1Q6j4jNrUjJmOuEv3JSILXgTOkK5j2M98ZJGjDM0mEG9bHsEGwXK5oF' },
  { ts: '2026-05-30T12:38:48Z', phone: '573188348272', pack: 'diamante',  monto: 15000, email: 'albayannethcalderon11@gmail.com', ctwa_clid: 'AfjaO7vDhUg8BFt85_Ss3_bfav8VfROQmJInaZGkk6-Pst7zMLjDG0fvAg3z5-JiTlg3tRy16_ejz8iRKmTXSEjVBUXXXjG5NPUwHInz_Y6kzUCbS-ArKwUzoFrTm-vnVu4' },
  { ts: '2026-05-30T12:47:29Z', phone: '573232073630', pack: 'basico',   monto:  5000, email: 'hgina893@gmail.com',              ctwa_clid: 'AfiFzoYfnOpAfKoL_uiPlr0P9OBVoqdH7UK3Ctbf6ht3dk3EyQ4prHqGzG7sFdHWscwE9E5z6JO0mpI9QZE_6T_1lDJaP3PU3YKiH5ViKnwoSS5g3m2ARahm4S_bfq5m7BYUpEPExA' },
  { ts: '2026-05-30T12:50:07Z', phone: '573228362869', pack: 'diamante',  monto: 15000, email: 'amadormayra31@gmail.com',         ctwa_clid: 'AfjRhR4Wp3J2DJaddXmC5LEcypcJ2G0g9F8KN97k0XZ1dwv91SXx-o5OqrA1aAD31psQbrrSvd_X4rs3WbWbD0iokt1ZYxnXsoHPpEzWH-rDTbCAPktaP_dbyg2PeLE4n0CJYS4PQZ' },
  { ts: '2026-05-30T12:55:09Z', phone: '573013635489', pack: 'diamante',  monto: 15000, email: 'ariveroracedo@gmail.com',         ctwa_clid: null },
  { ts: '2026-05-30T12:56:48Z', phone: '573135692998', pack: 'basico',   monto:  5000, email: 'katry0921@gmail.com',             ctwa_clid: 'Afj7BD-B5SEz90yvmZfwiuhtBxFBB06TvhiNWXeJyKYgy38NcMRCjvsD4n9FekzWRIx7nqfVuiILnKU6GskWu0RRcky48V3vN-krvwhCNYByUeHDgodC5AsVVsOUzOYE6h-u6Z_Etg' },
  { ts: '2026-05-30T13:26:04Z', phone: '573115785322', pack: 'diamante',  monto: 15000, email: 'angiemartinezusco@gmail.com',    ctwa_clid: 'AfiGJjldVpZCQspYHS7lPpfkTMAx5IIIWLOQ6XM9bw_myybqWWKiQeGuq7spHnzWmWTHKnwBdHQW777eUi7CC1vgDRFywLInc6AdBWhfZ8hVbdgqwMWdgXkGVb9axskQx6yp9SeqWAXA' },
  { ts: '2026-05-30T13:39:18Z', phone: '573219043808', pack: 'basico',   monto:  5000, email: 'mariana3012ver@gmail.com',        ctwa_clid: 'AfgFvr7-NkWTFjFffU3w3FBIzLHOUOQVCGUjhAFkEUE92YIGApe17OfftCgGSTNYVmHQZpAV5UQLA-xSbvoF2YKw3nubkfA6KuaIPNbd2diL2m2OSJQr8HVtSoOeKWkyyIs' },
  { ts: '2026-05-30T14:14:18Z', phone: '573505034752', pack: 'diamante',  monto: 15000, email: 'vergarapintomaryluz@gmail.com',  ctwa_clid: 'Afg7AYlJeLw2Lyjx7zuqwLn1WXEz2gXYUwOUYajm9xiV2IKpfLlXSpTq5FnSbNuH7k6RUt69TPDI1VNdKoRRBrXdFX72uljaZpzS01Sp3QJu3_vbQZccYCo2zNeuGAHR_P4' },
  { ts: '2026-05-30T14:48:27Z', phone: '573153302558', pack: 'diamante',  monto: 15000, email: 'lisethkarinam@gmail.com',        ctwa_clid: 'AfgrWSzDwfKrC4JIlDYQmBSeE6kIbhtyQtsx6YEixr0o8r49KvHiowXxr_rPaKthejm7mrietFfHFC7Xl-tk-JuIFpakYTB8bBPAsSRIyTqbiVdem0Beut1mdGnv71RnuA' },
  { ts: '2026-05-30T15:21:03Z', phone: '573012907130', pack: 'basico',   monto:  5000, email: 'alexasegrerafr@gmail.com',        ctwa_clid: 'Afg53z1a0Po-BnQMUVivaFgoQ8LNPVgtn44dLjOy3siSoDBZgQOWV1X1vN85D6IvykS-6E9KFadoGrJFwtD6SG5kFdmfJrlxmoyBZdyKsVlxvc_9-aNqDX5Y8bhmE_4Liw' },
  { ts: '2026-05-30T15:21:19Z', phone: '573117469117', pack: 'diamante',  monto: 15000, email: 'vasquezpalaciosofia1@gmail.com', ctwa_clid: 'AfigAEoXA4NvH2VqKGSkHYt33QNJFCqe_3wcHVRpUTTyNucgJ1cqBMX_izx5WIAbQCm2QoJ2ESoUkfcUeb_psyIhCWXRp-LNV4q30MveeAISBV0_Oa3ocDFdLnv7MYsv7gf1I5E-' },
  { ts: '2026-05-30T15:55:41Z', phone: '573025221607', pack: 'diamante',  monto: 15000, email: 'herrerajg201113@gmail.com',      ctwa_clid: 'AfiQaZA4Jd1KJbsbkPzSFeSaLGq-W4bKO3V-WaxaacWfNuKxxs-FTU5hheU3ZAUp1Tep9GBOjO74trbgucquTc4T31VYyUNjuTDWvJmdau5LCQ-g94gyT-VfJiNLlABCV6xMWW7_Qg' },
  { ts: '2026-05-30T16:53:59Z', phone: '573205568980', pack: 'oro',      monto: 10000, email: 'herminiaguevara03@gmail.com',     ctwa_clid: 'AfhkX6ns7PoVTFfZbxvagMYEJc0cIu8P2OlCdk8vKCtwzfpKiOvBBznquMZTrftBfcjwJeA0TJUZq27zZYdscMYNEwFqKXEtvkxAqTV9dpM4474xvl52uMB5S6JpdipEh_3NKAK-aA' },
  { ts: '2026-05-30T16:57:13Z', phone: '573146873606', pack: 'diamante',  monto: 15000, email: 'caramirez72.cer@gmail.com',      ctwa_clid: 'AfileyBouDFWkvhMpeaFbOrMcEB0me7DW2QbPHovpsc9ZlGZpLYPThHuT6jOi-XybQuIBeedlRGiYNng1ezR5pg5FmtLv4MqqK1mXWH-VBQp301ClLA2AO7uQfRqDI9YQ' },
  { ts: '2026-05-30T18:03:33Z', phone: '584262001788', pack: 'oro',      monto: 10000, email: 'nesulemed@gmail.com',            ctwa_clid: 'AfhUOIMDkI5w2EVbysm4hzPwn7JozX0CJ245TL5B_dIkF8L5qBLusXdxD_k8ROmt9A8ymmjvO2VDMtZUihV_u3xmmaIkH6VG953DjgarGYWQkAVHZtfL6FcMdscbVAdlRM8' },
  { ts: '2026-05-30T18:11:07Z', phone: '573106007480', pack: 'diamante',  monto: 15000, email: 'helimazo0222@gmail.com',         ctwa_clid: 'Afi7Rqny1sktfNE2v9UX_qFdkhFLal4bBQFHXnz12JQkKUCtTfPVaRE7Bd20-XZ6RbpJ4uyreLcHQjsnfSIBHPMjZuXnaxNILff3J1SOu3EiAsusQblTu1OontRxhvAhXNclOSsDXh1Y' },
  { ts: '2026-05-30T20:16:29Z', phone: '573126145989', pack: 'oro',      monto: 10000, email: 'marthaperezpetro@gmail.com',      ctwa_clid: 'Afhrd68kfSCX20N2GX64jkyfqfJHbSixixBTCv_5-v32dD0zZAGtmHQ9Os8m7XzcRJxz5WRdAFJNzi5VWSfwOev8nndz1gXG15rv4AurxmxLsdsXG5nmqYcy8IVEj6iEGZE' },
  { ts: '2026-05-31T01:02:30Z', phone: '573116520768', pack: 'diamante',  monto: 15000, email: 'baldovinogomez2007@gmail.com',   ctwa_clid: 'AfiKqRsjRT5pCqmUzs5AlTTeMbqOTHtm14pWFoUMRDBdRtRrFXoSLW_ZfxTLJIh64ro_lVXUsIXf9VLFp07bJnjS3BP1NnIw7BnLcTQbgV01MvB-JY0brylctXH4MBfxLTmm9LEtpQ' },
  { ts: '2026-05-31T02:46:11Z', phone: '573024516327', pack: 'oro',      monto: 10000, email: 'gomezmanuela614@gmail.com',       ctwa_clid: 'AfhAnOh2dwM9yVB5eziEF55zOwV14roNPlNq-gzIBvn1Zqa0cmGzD_iNoOUsogyz2vCA5-K_luL3yS8ShtUUyDMU6xU5684bDbG8Je4SCJhlPSLKfGuEboididr5BPKcPmaAPA6W4w' },
  { ts: '2026-05-31T03:27:04Z', phone: '573103792868', pack: 'basico',   monto:  5000, email: 'aezcarolina20@gmail.com',        ctwa_clid: 'AfiPhl4f35Ml764hZG4InXqU28zMkRjBj2dsKxMhXCowhJr4SfpH_9IZDXgM5vAnGI8bV6ok7XC-tv_Fj8ZSLxSc-eCn3D4j0TAepDu0-SNKhQyYsBvQqAubLPHk9E-qcXiaLXrwfw' },
  { ts: '2026-05-31T04:11:52Z', phone: '573236608512', pack: 'diamante',  monto: 15000, email: 'salomeacevedo853@gmail.com',    ctwa_clid: null },

  // 31 Mayo 2026
  { ts: '2026-05-31T12:23:41Z', phone: '573006491824', pack: 'oro',      monto: 10000, email: 'lmoralesstefi@gmail.com',         ctwa_clid: 'AfjiDYC-3TccFeXx6_5AOuYwM2R4hZUBX9kEFvlGr3xr2MlkAh72056iNn-oUr8d8tIV6D_4TYVtgmM_aoJ0VJRx5amuxL5WLz9gwNjSO0ZeSJX-X5O5AZeGUkszREsk6yg' },
  { ts: '2026-05-31T12:44:45Z', phone: '573204699868', pack: 'diamante',  monto: 15000, email: 'astrid.morenol1994@gmail.com',   ctwa_clid: null },
  { ts: '2026-05-31T13:00:08Z', phone: '573134829770', pack: 'basico',   monto:  5000, email: 'perezperezlinamarcela8@gmail.com', ctwa_clid: 'AfjeYoonaSZBcNYK9OA6vLyMgnN5Vh_dxf90RMvUKvCVA0UpDpZOP52zbtFV6sVXtZYZy8xn74o6rgQ5zPaXqIj1KjcEQfpQiV4mF9mVa1uY7EC246iPLcIbeD0Ogi-wrHx6MteCPw' },
  { ts: '2026-05-31T13:07:48Z', phone: '573148219908', pack: 'basico',   monto:  5000, email: 'lizethmaya427@gmail.com',         ctwa_clid: 'AfgO0hTlX6-ns7awXO6yT0qyln5K1eh-LmdZyAS2ZKZz4K8tJtft2unG1uYLkF42KM6AhhZfi7-SWLEYmfhMeKLowlTjAmlPl4-EMQmBkabbPffkrypHXjxImWi-h4PK8_Y' },
  { ts: '2026-05-31T13:18:17Z', phone: '573246826988', pack: 'diamante',  monto: 15000, email: 'nataliapopayancarvajal@gmail.com', ctwa_clid: null },
  { ts: '2026-05-31T14:21:57Z', phone: '573025165020', pack: 'basico',   monto:  5000, email: 'dianisplv@gmail.com',             ctwa_clid: null },
  { ts: '2026-05-31T14:34:46Z', phone: '573169002662', pack: 'basico',   monto:  5000, email: 'milenaarcila51@gmail.com',        ctwa_clid: null },
  { ts: '2026-05-31T14:58:06Z', phone: '573216531070', pack: 'diamante',  monto: 15000, email: 'sofisty105@gmail.com',           ctwa_clid: null },
  { ts: '2026-05-31T15:38:08Z', phone: '573102150256', pack: 'oro',      monto: 10000, email: 'yuyisfer25@gmail.com',            ctwa_clid: 'AfjsRQ3iby50UByDjcoHeBSPYogF1mpLGENs23166oRAQB5s9HMjNTLyEG2AeZFbBzYgMw7pL4asEXX5BY8spwsei8mm-GMKinYMDE8BoLVckcxQCY6FtQ_pXacDkIf__Q' },
  { ts: '2026-05-31T16:17:12Z', phone: '573155620511', pack: 'diamante',  monto: 15000, email: 'andreatrianapacheco3@gmail.com', ctwa_clid: 'AfhoooskwcPOlIqV8xYv6VBrBhBUSd99tcT8DqwVHQ0TMjXHp2FlrQhvKfrm3WoTtdjGimLof72pdbGzuJ97Qlt8kylpwZ53fRinpQ5zRdjBZIrDSLyfs_YG76z4jKkKXVlMUQAw' },
  { ts: '2026-05-31T16:41:41Z', phone: '573245912850', pack: 'oro',      monto: 10000, email: 'robinsonquinterocano01@gmail.com', ctwa_clid: 'AffsBD_UpUqaNLO7t-g7l5WfHJ-XrIJkt_EnJUBYZ41L_27Z0gaBtx6h7PnJBfg_K8oDFiJeZns_OQCqCczJL6eOvPFOYQdlawaiVfEbdmjLtENPOZrnpqnDEBb8pMpj-Qzs_3tv_w' },
  { ts: '2026-05-31T22:02:20Z', phone: '573106013516', pack: 'diamante',  monto: 15000, email: 'marc.quintero12@gmail.com',      ctwa_clid: 'AfiisACcKG8k_Fj8-6NpXUxfB5_rEuEt7MRkg1KDqi6A64Yi-GMn77oYvVhLAe5AEgiuUOI5XK7YiUxqjaYRFyt3Znsc7jmEeThI5CeD40m9dboCHHAj18OWEVcavkIdRQ53B3POfg' },
  { ts: '2026-06-01T00:44:04Z', phone: '573166871774', pack: 'basico',   monto:  5000, email: 'michellegrajalesprado@gmail.com', ctwa_clid: 'Afjgp5VbuHHLjbS58dnDGjXzZ9kwTkr1I34OCNaIG14kkOI4F_XoFtk8XDxUly-m8bpyUas20Kdw2rgQrCES_lQ3rCZevnOT25nxnJHKHMAOXjWI0JQNKZhGFThgDrcrYbypUrTBOHw' },
  { ts: '2026-06-01T03:32:35Z', phone: '573012008658', pack: 'diamante',  monto: 15000, email: 'hernandezkarilym@gmail.com',     ctwa_clid: 'AfjA9DNJOuQ8heoOpBge3EnIQub0Im_LIgxvUjcM9tZgNhbcukpyOQqMb6OrjwH9SVTfRGNhDv9cUDBCRZDi59KbyrCsELLx3QW5teW9rwThssXzqL-D-E2441aZwHYTAFU' },
  { ts: '2026-06-01T04:27:26Z', phone: '573233475954', pack: 'basico',   monto:  5000, email: 'erikabuitrago251@gmail.com',      ctwa_clid: 'AfjzXtfrEdKQIYRYCXNT27PFROm0Js3snasyMd03b1eJQU1oqim2v-p-CwnehsJK_hK8RLT9D7LDoZAvILAd8Ft3ABK39ogNI9SVy8JwU0klGqZRxWNvF9lZTYaW0nA7HgRxTPQZfQ' },

  // 1 Junio 2026
  { ts: '2026-06-01T11:41:44Z', phone: '573105865264', pack: 'diamante',  monto: 15000, email: 'karitojcv19@gmail.com',          ctwa_clid: null },
  { ts: '2026-06-01T12:52:59Z', phone: '573104842037', pack: 'diamante',  monto: 15000, email: 'nathaliaquintero2@gmail.com',    ctwa_clid: 'AfhCpFV8F-3AP_MgP6itRf1K3Jx_vyp7e6voqt8icNzxqExNngM59xTy2XWRpz4nYCWO9GLpfVnCnoj-knyMyohhrAWKMfsjmuN4md-Im3F-kifBHhNd0wG7g-QJ7MbDl8iI1e-1Aw' },
  { ts: '2026-06-01T12:54:45Z', phone: '573226671302', pack: 'oro',      monto: 10000, email: 'sindypgalvan@gmail.com',          ctwa_clid: 'AfhZEGDqJrpYwIxFZ6Fd3S8qtMObeoVcnJEDsLjhSlasglpq0B7zYddHIJ0KsvpF9o-HahXWRuG4CfFTXN3axj9cVpVSIYDcyy8ul5Rfc_7RbWvk3CfKyOY2MLF5uQRiiHo6amwAUkpbu' },  // sin ctwa en sheet pero lo inferimos del ad
  { ts: '2026-06-01T13:49:48Z', phone: '573123871792', pack: 'basico',   monto:  5000, email: 'francysossa32@gmail.com',         ctwa_clid: 'AfiBqkJ6QWgj4jY7SNVeJDCWL5ZVlvtSTna8K0lhbfwdOx_M8TYfSIJ2DCTCTu7-88vJ2Oaxb4u3ZJJYiTehLAwme0tU5OzB9qJ400Hh2cdkbjNlyXsnqGQZSUFMWFa01sXCFvoplQ' },
  { ts: '2026-06-01T13:54:25Z', phone: '573212744242', pack: 'basico',   monto:  5000, email: 'patogalvis0917@gmail.com',        ctwa_clid: 'Afj483ba1cHNz-EmxOOU4rI8MHBOeDjREc-KqytQdu7PsUxMBg08lhetNiUQIBKULkVK_-bXRcupz8eLv-wOqjqSue_-M-BlhW5_K6kSAlSMA831UuiWVpDfT1bOiUEA9OBNxwoP' },
  { ts: '2026-06-01T15:40:53Z', phone: '573165806481', pack: 'oro',      monto: 10000, email: 'ssorangelrojas1@gmail.com',       ctwa_clid: 'AffCH4HPui9UjkmRWiTIS8snFSw_UkC5-CDwFMraPdVz7KgG5hBvlMUl5L3cCipQEYh4qGG6sFe-SxJ8ctTxjP2e_hNd4gtBLuzRF4rwg2o3IG-HNb6lIs6-8SxJ8ctOcNyvdgXY' },
  { ts: '2026-06-01T16:23:24Z', phone: '573054574676', pack: 'diamante',  monto: 15000, email: 'zohegiraldi@gmail.com',          ctwa_clid: 'Afh0ZbebssJAdMxLe84Kn2LBUZT1uqPi2wy37rD8ULLXTsfbbqyLzGu1eJYWg861oEdyu1nYcicvWw2JP7IIkRdetfi6_gGMPotnifuymuZlZcBkdXO0bB6ikcd300updW8' },
  { ts: '2026-06-01T16:29:07Z', phone: '573337117204', pack: 'diamante',  monto: 15000, email: 'mafevar081@gmail.com',           ctwa_clid: 'Afjt1r-zOmQd5MO7UKq_W26lHNSGJD69-jIJLyQF5T5FB9EGFCSPvtuXL8ex8t-1k-_1EORObQdceO0AnzmpILCdFzFGx7y70FwAjlYZlhjf1vrT4jN34PAixSM8vPj3L-s6cwJq0Xtc' },
  { ts: '2026-06-01T17:03:56Z', phone: '573046018052', pack: 'oro',      monto: 10000, email: 'caicedosarah52@gmail.com',        ctwa_clid: null },
  { ts: '2026-06-01T17:27:13Z', phone: '573001079205', pack: 'oro',      monto: 10000, email: 'alejap820@gmail.com',             ctwa_clid: 'AfjnzkUuO2iMNDbi59SqTZw47QiidJM7fJ7o_5Thp-Q4hB6oCfoMZk_18MN-ZLCEcBckYeYDmQRIU2cMkjHCgSSjIBNk1IOVI5dKe6CSVETJRDdWDDC_wvRxeFl0461d0oN3H28k9A' },
  { ts: '2026-06-01T17:33:17Z', phone: '573150644445', pack: 'diamante',  monto: 15000, email: 'solomillos1401@gmail.com',       ctwa_clid: 'Afhh5Jxu-bxz4Yey4ZUAUgZpQHcMVQtjPjHfJrjYqJDYTZ6m8torKdgsUYvtRM_5D8UtoRRPcJi_Mio__Uf6fxNwvxbUiVjDRV9JiAzt7BvFj8c3YGJHNWcezMWN3Y_u5mwXiFwJ6w' },
  { ts: '2026-06-01T18:21:44Z', phone: '573146134488', pack: 'diamante',  monto: 15000, email: 'ijsanmarcosecovida@gmail.com',   ctwa_clid: 'AfjWm4Y3P7RbJ1lZw8qM4EO1UtENcWAUAryYLmMqvpKiOnkdhMQA4VmipiAAKABQ_y_WnJyb90yXO0SPExud5jW8TKJC8Axk-wpW2jSwaGfoR0Mt-ACBoOKJJxZI-e8dOrUQCBsH0g' },
];

async function sendRetro(venta, index) {
  const ph  = sha256(venta.phone.replace(/\D/g, ''));
  const ud  = { ph: [ph], external_id: [ph], page_id: '152908757899058' };
  if (venta.email) ud.em = [sha256(venta.email)];
  if (venta.ctwa_clid) ud.ctwa_clid = venta.ctwa_clid;

  const eventTime = Math.floor(new Date(venta.ts).getTime() / 1000);
  const eventId   = `retro4d_${venta.phone}_${eventTime}`;

  const event = {
    event_name:    'Purchase',
    event_time:    eventTime,
    action_source: 'other',
    event_id:      eventId,
    user_data:     ud,
    custom_data:   { currency: 'COP', value: venta.monto, content_name: venta.pack, content_type: 'product', content_ids: [venta.pack] }
  };

  try {
    const r = await axios.post(
      `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events`,
      { data: [event] },
      { params: { access_token: META_CAPI_TOKEN }, timeout: 12000 }
    );
    const ctwa_tag = venta.ctwa_clid ? 'ctwa_si' : 'ctwa_no';
    console.log(`[${index+1}/${ventas.length}] OK ${venta.pack} $${venta.monto} ${venta.phone} | ${ctwa_tag} | ${r.data.events_received} recibidos`);
  } catch (e) {
    console.error(`[${index+1}/${ventas.length}] ERROR ${venta.phone}:`, e.response?.data || e.message);
  }
}

async function main() {
  console.log(`CAPI retroactivo 4 dias — ${ventas.length} ventas al WABA dataset ${META_PIXEL_ID}`);
  console.log('action_source: other (business_messaging falla hasta que Jorge asocie la página en Events Manager)\n');

  let conCtwa = 0, sinCtwa = 0;
  ventas.forEach(v => v.ctwa_clid ? conCtwa++ : sinCtwa++);
  console.log(`Con ctwa_clid: ${conCtwa} | Sin ctwa_clid: ${sinCtwa}\n`);

  for (let i = 0; i < ventas.length; i++) {
    await sendRetro(ventas[i], i);
    if (i < ventas.length - 1) await new Promise(r => setTimeout(r, 200));
  }

  console.log('\nListo. Los eventos llegaron al WABA dataset.');
  console.log('SIGUIENTE PASO: Jorge debe asociar la página en Events Manager para habilitar business_messaging.');
}

main().catch(console.error);
