import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        // A aba Links virou Portfólio (#208). Temporário (307) e não permanente:
        // o 308 fica guardado no navegador para sempre, e se um dia `/links`
        // voltar a ser uma página, quem já visitou continuaria sendo mandado
        // embora sem nem perguntar ao servidor.
        source: "/links",
        destination: "/portfolio",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        // O service worker de envio precisa vir sempre do servidor: uma cópia
        // antiga em cache continuaria enviando áudio com regras velhas.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
