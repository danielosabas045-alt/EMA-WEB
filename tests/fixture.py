"""Generate fictitious EMA workbooks, with a fixed 50-order acceptance dataset."""
import argparse
from datetime import date
from pathlib import Path

from openpyxl import Workbook

HEADERS = (
    "Número de pedido", "Cliente", "Fecha", "Vendedor", "Sucursal",
    "Código de producto", "Producto", "Cantidad", "Precio unitario", "Total línea",
)


def make_workbook(path, count=50):
    book = Workbook(write_only=True)
    sheet = book.create_sheet("Pedidos ficticios")
    sheet.append(HEADERS)
    for index in range(count):
        # 49 × Q225.00 + Q402.75 = Q11,427.75. Cycles are stable for each group.
        amount = 402.75 if index == count - 1 else 225
        sheet.append((
            f"QA-{index + 1:06}", f"C{index % 15:02}|Cliente ficticio {index % 15 + 1:02}",
            date(2025, 1 + (index // 10) % 5, 1 + index % 10).isoformat(),
            f"V{index % 4:02}|Vendedor ficticio {index % 4 + 1:02}",
            ["Centro", "Norte", "Sur"][index % 3], f"P{index % 7:03}",
            f"Producto ficticio {index % 7 + 1:02}", 1, amount, amount,
        ))
    book.save(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--count", type=int, default=50)
    args = parser.parse_args()
    make_workbook(args.output, args.count)
