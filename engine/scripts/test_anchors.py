import pathlib
import tempfile
import unittest
import anchors


class ReplacementChecks(unittest.TestCase):
    def check(self, files, mutation):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            source, work = root / 'source', root / 'work'
            source.mkdir()
            work.mkdir()
            for name, body in files.items():
                (source / name).write_text(body)
            script = root / 'mutation.py'
            script.write_text('from pathlib import Path\n' + mutation)
            result, report = anchors.check_script(script, source, work)
            self.assertEqual({p.name: p.read_text() for p in source.iterdir()}, files)
            return result, report

    def test_floor_type_anchor_silently_misses_in_second_file(self):
        result, report = self.check(
            {'http.ts': 'allowed', 'offers.ts': 'is_exploration: boolean;\ngiven_by: string;\n}[];\nif (marked < required)'},
            "p=Path('src/http.ts'); s=p.read_text()\ns=s.replace('allowed','allowed floorMet',1); p.write_text(s)\n"
            "p=Path('src/offers.ts'); s=p.read_text()\ns=s.replace('is_exploration: boolean;\\n}[];', 'floorMet?: boolean;',1)\n"
            "s=s.replace('if (marked < required)', 'if (!input.floorMet && marked < required)',1); p.write_text(s)\n")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report['checked'], 3)
        self.assertEqual([x['anchor'] for x in report['missing']], ['is_exploration: boolean;\n}[];'])

    def test_sequential_intermediate_anchor_is_valid(self):
        result, report = self.check({'a': 'original'},
            "p=Path('src/a'); s=p.read_text()\ns=s.replace('original','intermediate',1)\ns=s.replace('intermediate','final',1); p.write_text(s)\n")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report['checked'], 2)
        self.assertEqual(report['missing'], [])

    def test_anchor_in_other_file_does_not_satisfy_target(self):
        result, report = self.check({'a': 'only-a', 'b': 'only-b'},
            "p=Path('src/a'); s=p.read_text(); s=s.replace('only-a','changed-a',1); p.write_text(s)\n"
            "q=Path('src/b'); t=q.read_text(); t=t.replace('only-a','changed-b',1); q.write_text(t)\n")
        self.assertEqual(result.returncode, 0)
        self.assertEqual([x['anchor'] for x in report['missing']], ['only-a'])

    def test_unrelated_normalisation_is_not_an_anchor(self):
        result, report = self.check({'a': 'original'},
            "name='route'.replace('/', '_')\np=Path('src/a'); s=p.read_text(); s=s.replace('original',name,1); p.write_text(s)\n")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report['checked'], 1)
        self.assertEqual(report['untracked_calls'], 1)
        self.assertEqual(report['missing'], [])

    def test_script_failure_preserves_prior_missing_report(self):
        result, report = self.check({'a': 'original'},
            "p=Path('src/a'); s=p.read_text(); s=s.replace('absent','final',1)\nraise RuntimeError('broken mutation')\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([x['anchor'] for x in report['missing']], ['absent'])


if __name__ == '__main__':
    unittest.main()
