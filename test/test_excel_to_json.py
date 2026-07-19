import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from excel_to_json import ValidationError, parse_workbook  # noqa: E402


class ExcelParserTest(unittest.TestCase):
    def make_workbook(self, headers, rows):
        directory = tempfile.TemporaryDirectory()
        path = Path(directory.name) / "项目数据库.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "项目数据库"
        sheet.append(headers)
        for row in rows:
            sheet.append(row)
        workbook.save(path)
        workbook.close()
        self.addCleanup(directory.cleanup)
        return path

    def test_parse_public_fields(self):
        path = self.make_workbook(
            ["项目系列", "项目编号", "项目名称", "单片机分类", "项目用途", "使用模块", "仿真+仿真代码", "论文", "是否展示", "排序"],
            [["T系列", "T001", "STM32温湿度监测", "STM32", "温度检测、环境监测", "DHT11，OLED", 200, "面议", "是", 3]],
        )
        payload = parse_workbook(path)
        project = payload["projects"][0]
        self.assertEqual(project["id"], "T系列::T001")
        self.assertEqual(project["code"], "T001")
        self.assertEqual(project["usages"], ["温度检测", "环境监测"])
        self.assertEqual(project["modules"], ["DHT11", "OLED"])
        self.assertEqual(
            project["prices"],
            [{"label": "仿真+仿真代码", "price": 200}, {"label": "论文", "price": "面议"}],
        )
        self.assertEqual(project["sort"], 3)

    def test_reject_forbidden_headers(self):
        path = self.make_workbook(
            ["项目编号", "项目名称", "单片机分类", "下载链接"],
            [["T001", "测试项目", "STM32", "https://example.com"]],
        )
        with self.assertRaisesRegex(ValidationError, "公开Excel不能包含"):
            parse_workbook(path)

    def test_reject_duplicate_ids(self):
        path = self.make_workbook(
            ["项目编号", "项目名称", "单片机分类"],
            [["T001", "项目一", "STM32"], ["T001", "项目二", "51单片机"]],
        )
        with self.assertRaisesRegex(ValidationError, "重复"):
            parse_workbook(path)

    def test_reject_invalid_price(self):
        path = self.make_workbook(
            ["项目编号", "项目名称", "单片机分类", "仿真+仿真代码"],
            [["T001", "测试项目", "STM32", "一百元"]],
        )
        with self.assertRaisesRegex(ValidationError, "必须填写金额"):
            parse_workbook(path)


if __name__ == "__main__":
    unittest.main()
