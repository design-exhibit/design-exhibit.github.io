import base64
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from excel_to_json import ValidationError, parse_workbook, write_assets  # noqa: E402


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

    def add_wps_images(self, path):
        image = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        )
        cell_images = """<?xml version="1.0" encoding="UTF-8"?>
<etc:cellImages xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData"
 xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr name="ID_SIM"/></xdr:nvPicPr>
    <xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></etc:cellImage>
  <etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr name="ID_HW"/></xdr:nvPicPr>
    <xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic></etc:cellImage>
</etc:cellImages>"""
        relationships = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>"""
        with ZipFile(path, "a") as archive:
            archive.writestr("xl/cellimages.xml", cell_images)
            archive.writestr("xl/_rels/cellimages.xml.rels", relationships)
            archive.writestr("xl/media/image1.png", image)

    def add_incomplete_wps_index(self, path):
        cell_images = """<?xml version="1.0" encoding="UTF-8"?>
<etc:cellImages xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData"/>"""
        with ZipFile(path, "a") as archive:
            archive.writestr("xl/cellimages.xml", cell_images)

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
            ["项目编号", "项目名称", "单片机分类", "资料主要内容"],
            [["T001", "测试项目", "STM32", "内部资料"]],
        )
        with self.assertRaisesRegex(ValidationError, "公开Excel不能包含"):
            parse_workbook(path)

    def test_parse_new_document_prices(self):
        path = self.make_workbook(
            [
                "项目编号", "项目名称", "单片机分类", "成果书", "任务书",
                "PPT送答辩模板", "成果书+任务书+PPT+答辩模板+过AI+过查重",
            ],
            [["T001", "测试项目", "STM32", 100, 10, 20, 400]],
        )

        project = parse_workbook(path)["projects"][0]

        self.assertEqual(
            project["prices"],
            [
                {"label": "成果书", "price": 100},
                {"label": "任务书", "price": 10},
                {"label": "PPT送答辩模板", "price": 20},
                {"label": "成果书+任务书+PPT+答辩模板+过AI+过查重", "price": 400},
            ],
        )

    def test_parse_wps_images_and_skip_absent_price(self):
        path = self.make_workbook(
            [
                "项目编号", "项目名称", "单片机分类", "仿真图片", "实物图片",
                "仿真+仿真代码", "原理图+PCB设计",
            ],
            [[
                "T001", "测试图片项目", "STM32",
                '=_xlfn.DISPIMG("ID_SIM",1)', '=DISPIMG("ID_HW",1)', "无", 0,
            ]],
        )
        self.add_wps_images(path)
        assets = {}

        project = parse_workbook(path, assets)["projects"][0]

        self.assertEqual(project["prices"], [{"label": "原理图+PCB设计", "price": 0}])
        self.assertEqual(project["simulationImage"]["width"], 1)
        self.assertEqual(project["hardwareImage"]["height"], 1)
        self.assertEqual(len(assets), 1)
        output = path.parent / "site" / "assets" / "generated" / "projects"
        write_assets(assets, path.parent)
        self.assertEqual(len(list(output.iterdir())), 1)

    def test_ignore_incomplete_wps_index_without_project_images(self):
        path = self.make_workbook(
            ["项目编号", "项目名称", "单片机分类", "仿真图片", "实物图片"],
            [["T001", "无图片项目", "STM32", "", None]],
        )
        self.add_incomplete_wps_index(path)

        payload = parse_workbook(path)

        self.assertEqual(len(payload["projects"]), 1)
        self.assertNotIn("simulationImage", payload["projects"][0])

    def test_reject_incomplete_wps_index_when_image_is_used(self):
        path = self.make_workbook(
            ["项目编号", "项目名称", "单片机分类", "仿真图片"],
            [["T001", "图片缺失项目", "STM32", '=DISPIMG("ID_MISSING",1)']],
        )
        self.add_incomplete_wps_index(path)

        with self.assertRaisesRegex(ValidationError, "WPS图片索引不完整"):
            parse_workbook(path)

    def test_ignore_blank_template_row_with_sequence_formula(self):
        path = self.make_workbook(
            ["序号", "项目编号", "项目名称", "单片机分类"],
            [
                ['=IF(B2<>"",ROW()-1,"")', None, None, None],
                [1, "T001", "有效项目", "STM32"],
            ],
        )

        payload = parse_workbook(path)

        self.assertEqual([project["code"] for project in payload["projects"]], ["T001"])

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
